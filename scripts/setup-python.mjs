import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const environmentPython = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

try {
  if (!existsSync(environmentPython)) {
    console.log(`Criando ambiente virtual Python com ${python}...`)
    run(python, ['-m', 'venv', '.venv'])
  }
  console.log('Instalando scikit-learn e joblib no ambiente isolado do projeto...')
  run(environmentPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  run(environmentPython, ['-m', 'pip', 'install', '-r', 'python/requirements.txt'])
  console.log('Ambiente Python pronto. Rode npm run dev para iniciar os dois serviços locais.')
} catch (error) {
  console.error(`Não foi possível preparar o Python: ${error.message}`)
  process.exit(1)
}
