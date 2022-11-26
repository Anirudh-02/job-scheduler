const Joi = require('joi')
const express = require('express')
const amqp = require('amqplib')
const grpcClient = require('./grpcClient')
const dotenv = require('dotenv').config()

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
const PORT = process.env.PORT || 3002

connectSmsQueue()

const jobSchema = Joi.object({
    name: Joi.string().
        required(),
    priority: [
        Joi.string().valid('High', 'Medium', 'Low').required(),
        Joi.number().valid(1, 2, 3).required()
    ],
    dependency: [Joi.number(), Joi.string().valid('', null)]
})

//post route to add sms tasks
app.post('/sms-service/add-task', async (req, res) => {
    try {
        const validatedInput = jobSchema.validate(req.body)
        if (validatedInput.error) {
            return res.status(400).send(validatedInput.error)
        }
        const task = { ...validatedInput.value, time_stamp: Date.now(), type: 'sms' }
        await sendSmsTaskToQueue(task)
        res.status(200).send({ message: 'sms task received' })
    } catch (error) {
        res.status(500).send({ message: 'error' })
    }
})

//get route to fetch scheduled sms tasks using grpc
app.get('/sms-service/get-scheduled-sms', (req, res) => {
    grpcClient.getAllScheduledSms({}, (error, smsList) => {
        if (error) {
            res.status(500).send({ message: 'error' })
        } else {
            res.status(200).send(smsList.tasks)
        }
    })
})

//function to connect to sms queue
let channel, connection
async function connectSmsQueue() {
    try {
        connection = await amqp.connect('amqp://localhost:5672')
        channel = await connection.createChannel()

        await channel.assertQueue('sms-queue')
    } catch (err) {
        console.log(err)
    }
}

//helper function to send received sms task to sms queue
async function sendSmsTaskToQueue(task) {
    await channel.sendToQueue('sms-queue', Buffer.from(JSON.stringify(task)))
}

app.listen(PORT, () => {
    console.log(`SMS service started at: http://localhost:${PORT}`);
})
