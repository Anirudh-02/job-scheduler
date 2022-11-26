const Joi = require('joi')
const express = require('express')
const amqp = require('amqplib')
const grpcClient = require('./grpcClient')
const dotenv = require('dotenv').config()


const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
const PORT = process.env.PORT || 3001

connectMailQueue()

const jobSchema = Joi.object({
    name: Joi.string().
        required(),
    priority: [
        Joi.string().valid('High', 'Medium', 'Low').required(),
        Joi.number().valid(1, 2, 3).required()
    ],
    dependency: [Joi.number(), Joi.string().valid('', null)]
})

//post route to add mail tasks
app.post('/mail-service/add-task', async (req, res) => {
    try {
        const validatedInput = jobSchema.validate(req.body)
        if (validatedInput.error) {
            return res.status(400).send(validatedInput.error)
        }
        const task = { ...validatedInput.value, time_stamp: Date.now(), type: 'mail' }
        await sendMailTaskToQueue(task)
        res.status(200).send({ message: 'mail task received' })
    } catch (error) {
        res.status(500).send({ message: 'error' })
    }
})

//get routed to fetch scheduled mail tasks using grpc
app.get('/mail-service/get-scheduled-mail', (req, res) => {
    grpcClient.getAllScheduledMails({}, (error, mailList) => {
        if (error) {
            res.status(500).send({ message: error.message })
        } else {
            res.status(200).send(mailList.tasks)
        }
    })
})


//connecting to the mail queue
let channel, connection
async function connectMailQueue() {
    try {
        connection = await amqp.connect('amqp://localhost:5672')
        channel = await connection.createChannel()

        await channel.assertQueue('mail-queue')
    } catch (err) {
        console.log(err)
    }
}

//helper function to send a received task to the mail queue
async function sendMailTaskToQueue(task) {
    await channel.sendToQueue('mail-queue', Buffer.from(JSON.stringify(task)))
}

app.listen(PORT, () => {
    console.log(`Mail service started at: http://localhost:${PORT}`);
})