// Starts DynamoDB Local in the foreground (in-memory, port 8000). Stop with Ctrl+C.
const { spawn } = require('child_process');
const path = require('path');
const dir = path.join(__dirname, '..', '..', '.dynamodb-local');
spawn('java', [`-Djava.library.path=${path.join(dir, 'DynamoDBLocal_lib')}`, '-jar', path.join(dir, 'DynamoDBLocal.jar'), '-inMemory', '-port', '8000'],
  { cwd: dir, stdio: 'inherit' }).on('exit', (c) => process.exit(c || 0));
