import paramiko

def run_ssh_commands(host, username, password, commands):
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(host, port=22, username=username, password=password, timeout=15)
        for cmd in commands:
            print(f"RUNNING: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace'))
            print(stderr.read().decode('utf-8', errors='replace'))
        client.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    commands = [
        "docker exec -i amt-pricelist-db-1 psql -U amt -d amt_pricelist -c \"SELECT id, filename, status, mode, version, created_at FROM import_jobs ORDER BY created_at DESC LIMIT 5;\"",
        "docker exec -i amt-pricelist-db-1 psql -U amt -d amt_pricelist -c \"SELECT job_id, decision, verified, count(*) FROM import_rows GROUP BY job_id, decision, verified ORDER BY job_id LIMIT 10;\""
    ]
    run_ssh_commands("76.13.244.160", "root", "Jaleel@12994", commands)
