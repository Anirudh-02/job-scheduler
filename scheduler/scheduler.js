const express = require('express')
const amqp = require('amqplib')
const { createClient } = require('redis')
const { db, Tasks } = require('./models/db')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const dotenv = require('dotenv').config()

//connecting to Redis
let redisClient = createClient()
redisClient.connect()
    .then(() => {
        console.log('connected to redis');
    })

//Syncing DB and starting the express server for scheduler
const app = express()
const PORT = process.env.PORT || 3003
db.sync({ force: true })
    .then(() => {
        console.log('database synced');
        app.listen(PORT, () => {
            console.log(`scheduler started at http://localhost:${PORT}`);
        })
    })
    .catch(err => {
        console.log(err);
    })

// connecting to queues
connectMailQueue()
connectSmsQueue()

// GET route to fetch schedule
app.get('/get_schedule', async (req, res) => {
    try {
        const schedule = await redisClient.lRange('schedule', 0, -1)
        //need to JSON parse tasks before sending since they are stored in redis in stringified form
        const scheduleJson = schedule.map(task => JSON.parse(task))
        res.status(200).send(scheduleJson)
    } catch (error) {
        console.log(error);
        res.status(500).send({ message: 'Error' })
    }
})

//============================================
//             helper functions
// ===========================================


//function to get current schedule and store it in a redis queue
async function getScheduleAndStoreInRedis() {
    //schedule task
    const tasks = await getAllTasks()
    const schedule = []
    const toSkip = []
    tasks.forEach((task, index) => {
        if (toSkip.includes(index)) {
            return
        }
        pushDependencyToSchedule(task, tasks, toSkip, schedule)
        schedule.push(JSON.stringify({
            name: task.name,
            type: task.type
        }))
    })
    //clear the previous schedule stored in redis since this function will run to create a new schedule every time a new task is added
    await redisClient.lTrim('schedule', 1, 0)
    //add new schedule to redis
    await redisClient.rPush('schedule', schedule)
}

//helper function to push dependencies of a task to the schedule first
function pushDependencyToSchedule(task, tasksArr, toSkipArr, scheduleArr) {
    if (task.dependency == null) {
        return
    }
    toSkipArr.push(dependencyIndex)
    pushDependencyToSchedule(tasksArr[dependencyIndex], tasksArr, toSkipArr, scheduleArr)
    if (!scheduleArr.some(el => el.name == tasksArr[dependencyIndex].name)) {
        scheduleArr.push(JSON.stringify({
            name: tasksArr[dependencyIndex].name,
            type: tasksArr[dependencyIndex].type
        }))
    }
}

//helper function get all tasks from the database
async function getAllTasks() {
    const all_tasks = await Tasks.findAll({
        order: [
            ['priority', 'ASC'],
            //sorting tasks by dependency to make sure tasks with NULL dependency show up first for each priority value, the rest of the order doesn't matter
            ['dependency', 'ASC']
        ]
    })
    return all_tasks
}

// helper function to format task to add to SQL DB
// This was necessary as Sequelize doesn't allow ENUM datatype for MySQL (Postgres only), so we needed to convert 'High', 'Low' and 'Medium' values of priority to an integer
// This function also sets dependency to NULL if someone submitted an empty string for it
function formatTaskToAddInDb(taskFromQueue) {
    const task = JSON.parse(Buffer.from(taskFromQueue.content).toString())
    task.dependency == "" ? task.dependency = null : null
    switch (task.priority) {
        case 'High': {
            task.priority = 1
            break
        }
        case 'Medium': {
            task.priority = 2
            break
        }
        case 'Low': {
            task.priority = 3
            break
        }
    }
    return task
}

// ==================================================================
// functions to consume mail and sms queues and create tasks in DB
// ==================================================================

let mailChannel, mailConnection
async function connectMailQueue() {
    try {
        mailConnection = await amqp.connect('amqp://localhost:5672')
        mailChannel = await mailConnection.createChannel()

        await mailChannel.assertQueue('mail-queue')
        mailChannel.consume('mail-queue', async (mailTask) => {
            console.log(`${Buffer.from(mailTask.content)}`);
            mailChannel.ack(mailTask)
            const task = formatTaskToAddInDb(mailTask)
            if (task.dependency) {
                const dependency = await Tasks.findOne({
                    where: {
                        id: task.dependency
                    }
                })
                // Tasks whose dependency doesn't exist or has a time_stamp greater than their own will not be added
                if (!dependency || dependency.time_stamp > task.time_stamp) {
                    console.log('invalid dependency');
                    return
                }
            }
            await Tasks.create(task)
            getScheduleAndStoreInRedis()
        })
    } catch (error) {
        console.log(error);
    }
}

let smsChannel, smsConnection
async function connectSmsQueue() {
    try {
        smsConnection = await amqp.connect('amqp://localhost:5672')
        smsChannel = await smsConnection.createChannel()

        await smsChannel.assertQueue('sms-queue')
        smsChannel.consume('sms-queue', async (smsTask) => {
            console.log(`${Buffer.from(smsTask.content)}`);
            smsChannel.ack(smsTask)
            const task = formatTaskToAddInDb(smsTask)
            if (task.dependency) {
                const dependency = await Tasks.findOne({
                    where: {
                        id: task.dependency
                    }
                })
                // Tasks whose dependency doesn't exist or has a time_stamp greater than their own will not be added
                if (!dependency || dependency.time_stamp > task.time_stamp) {
                    console.log('invalid dependency');
                    return
                }
            }
            await Tasks.create(task)
            getScheduleAndStoreInRedis()
        })
    } catch (error) {
        console.log(error);
    }
}

// =============================================
//               gRPC server
// =============================================

const PROTO_PATH = '../tasks.proto'

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    arrays: true
})

let tasksProto = grpc.loadPackageDefinition(packageDefinition)

const grpcServer = new grpc.Server()

// Mail service
grpcServer.addService(tasksProto.MailService.service, {
    getAllScheduledMails: async (_, callback) => {
        const schedule = await redisClient.lRange('schedule', 0, -1)
        // filter from schedule stored in redis by type 'mail'
        const mailList = schedule.filter(task => JSON.parse(task).type == 'mail')
        // parse the array as JSON since data stored in redis is stringified
        const tasks = mailList.map(task => JSON.parse(task))
        callback(null, { tasks })
    }
})

// SMS service
grpcServer.addService(tasksProto.SmsService.service, {
    getAllScheduledSms: async (_, callback) => {
        const schedule = await redisClient.lRange('schedule', 0, -1)
        // filter from schedule stored in redis by type 'sms'
        const smsList = schedule.filter(task => JSON.parse(task).type == 'sms')
        // parse the array as JSON since data stored in redis is stringified
        const tasks = smsList.map(task => JSON.parse(task))
        callback(null, { tasks })
    }
})

grpcServer.bindAsync('127.0.0.1:50051', grpc.ServerCredentials.createInsecure(), (error, port) => {
    console.log('grpc grpcServer started at http://127.0.0.1:50051');
    grpcServer.start()
})