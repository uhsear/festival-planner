import paramiko, sys, os

host = '192.168.0.150'
user = 'asir'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user)

cmd = sys.argv[1]
stdin, stdout, stderr = client.exec_command(cmd)
out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')
rc = stdout.channel.recv_exit_status()
print(out)
if err:
    print("STDERR:", err, file=sys.stderr)
sys.exit(rc)
