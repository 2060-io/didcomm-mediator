import axios from 'axios'

// Function to send REST messages
async function sendMessages(
  messageCount: number,
  port: number,
  connectionId: string,
  executionCount: number
): Promise<void> {
  console.log('Entered to send message')
  const url: string = `http://localhost:${port}/send-message`

  const startTime = performance.now() // Start the timer

  // Define a function to send messages at intervals
  async function sendMessageAtInterval() {
    for (let i = 1; i <= messageCount; i++) {
      const message = {
        connectionId: connectionId,
        message: `Message from ${port} - test message - msg ${i}`,
      }

      try {
        // Make a POST request using axios
        const response = await axios.post(url, message)
        console.log(`Message ${i} Status Code: ${response.status}`)
      } catch (error) {
        // Handle errors in case the request fails
        console.error('Error sending the message:', error.message)
      }
    }
  }

  // Function to control the interval and total execution times
  async function controlIntervalAndExecution() {
    for (let i = 1; i <= executionCount; i++) {
      console.log(`Execution number: ${i}`)
      await sendMessageAtInterval()
      if (i !== executionCount) {
        console.log(`Waiting 1 minute execution ${i} / ${executionCount}`)
        await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000)) // Wait for 1 minutes
      }
    }
  }

  await controlIntervalAndExecution()

  const endTime = performance.now() // Stop the timer
  const duration = endTime - startTime
  console.log(`Total Execution time: ${duration} milliseconds`)
}

// Get the message count, port, connectionId, and execution count from environment variables
const messageCount: number = parseInt(process.env.MESSAGE_COUNT || '5', 10)
const port: number = parseInt(process.env.PORT || '3040', 10)
const connectionId: string = process.env.CONNECTION_ID || 'c8bbfe6c-14cb-41f1-982f-87b03f456dd7'
const executionCount: number = parseInt(process.env.EXECUTION_COUNT || '5', 10)

// Call the function to send messages
sendMessages(messageCount, port, connectionId, executionCount)
