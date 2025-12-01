import express from "express";
import cors from "cors";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

const PORT = 3000;
const QUEUE_URL = "https://sqs.eu-west-3.amazonaws.com/340752836075/DietiEstates-Insertions-Queue";

const sqsClient = new SQSClient({ region: 'eu-west-3' });
const clients = new Set();
const sentMessages = new Set();

const app = express();
app.use(cors());
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write('data: {"type":"connected","message":"Connected to notification stream"}\n\n');

    clients.add(res);
    console.log('Client connected. Total clients:', clients.size);

    // Send previously sent messages to the newly connected client
    sentMessages.forEach(message => {
        res.write(`data: ${JSON.stringify(message)}\n\n`);
    });

    req.on('close', () => {
        clients.delete(res);
        console.log('Client disconnected. Total clients:', clients.size);
    });
});

function broadcastNotification(notification) {
    const data = `data: ${JSON.stringify(notification)}\n\n`;

    clients.forEach(client => {
        try {
            client.write(data);
        } catch (error) {
            console.error('Error writing to client:', error);
            clients.delete(client);
        }
    });
}

async function pollSQS() {
    if (clients.size === 0) {
        return; // No clients connected, skip polling
    }

    const response = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // Long polling
        MessageAttributeNames: ['All'],
        AttributeNames: ['All']
    }));

    if (!response.Messages) {
        return;
    }

    response.Messages.forEach(async message => {
        console.log('Received message from SQS:', message);

        broadcastNotification(message);

        sentMessages.add(message);

        await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle
        }));
    });
}

async function clearSentMessages() {
    sentMessages.clear();
    console.log('Cleared sent messages cache');
}

setInterval(pollSQS, 1000);
setInterval(clearSentMessages, 60000);

app.listen(PORT, () => {
    console.log(`SSE service is running on http://localhost:${PORT}`);
});