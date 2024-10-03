/**
 * Multiple_Agent.js has only been tested to work on Linux OS. The openTerminal method should handle the OS on which it is being executed.
 */
import spawn from 'cross-spawn'

// Function to wait for keyboard input to close the program
function waitForKey(keyCode: number): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.on('data', function (chunk) {
      if (chunk[0] === keyCode) {
        resolve()
        process.stdin.pause()
      }
    })
  })
}

// Function to build the command with a specific port.
function buildCommand(port: number): string {
  const baseCommand = `CLIENT_AGENT_PORT=${port} CLIENT_WALLET_ID=client-${port} node ./build/test/ClientAgent.js`
  return process.platform === 'win32' ? baseCommand : `${baseCommand}; exec bash`
}

// Function to open a new terminal window based on the operating system
function openTerminal(command: string): void {
  const openCommand =
    process.platform === 'win32'
      ? `start cmd /k "${command}"` // Windows
      : `x-terminal-emulator -e "${command}"` // Unix (Linux, macOS)

  spawn(openCommand, [], { stdio: 'ignore', detached: true, shell: true })
}

// Retrieve the number of clients from the command line
const numClients = Number(process.env.CLIENT_QTY_OPEN || 1) // Default to 1 client if no number is provided

// Define the initial port
const initialPort = 3020

// Create and execute commands in new terminal windows
for (let i = 0; i < numClients; i++) {
  const port = initialPort + i
  const command = buildCommand(port)
  openTerminal(command)
}
console.log('press enter to exit')
waitForKey(10)
