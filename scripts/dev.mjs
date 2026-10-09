import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const apiChild = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { stdio: 'inherit', env: process.env })
const webChild = spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', env: process.env })
const children = [apiChild, webChild]

const pythonExecutable = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'
if (existsSync(pythonExecutable)) {
  children.push(spawn(pythonExecutable, ['python/service.py'], { stdio: 'inherit', env: process.env }))
} else {
  console.log('[libras-python] ambiente ainda não preparado. Execute npm run setup:python para habilitar o classificador local.')
}

function stop() {
  if (stopping) return
  stopping = true
  children.forEach((child) => child.kill('SIGTERM'))
}

let stopping = false

for (const child of [apiChild, webChild]) {
  child.on('error', (error) => {
    console.error(`[dev] Não foi possível iniciar um serviço principal: ${error.message}`)
    process.exitCode = 1
    stop()
  })
  child.on('exit', (code) => {
    if (stopping) return
    process.exitCode = code || 1
    stop()
  })
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)

children.forEach((child) => {
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
})
