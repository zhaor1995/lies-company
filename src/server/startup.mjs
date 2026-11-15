import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);

export function configuredPort(value = process.env.PORT) {
  const text = value?.trim() || '4173';
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error('PORT 必须是 1～65535 的整数，请检查 src/.env.local 或启动环境变量。');
  }
  return Number(text);
}

async function listeningPids(port) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'tcp'], { timeout: 3000 });
      return [...new Set(stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
        .filter(parts => parts[0] === 'TCP' && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING')
        .map(parts => Number(parts[4])).filter(pid => Number.isInteger(pid) && pid > 0))];
    }
    const { stdout } = await exec('lsof', ['-nP', '-t', '-a', `-iTCP:${port}`, '-sTCP:LISTEN'], { timeout: 3000 });
    return [...new Set(stdout.trim().split(/\s+/).map(Number).filter(pid => Number.isInteger(pid) && pid > 0))];
  } catch (error) {
    // lsof uses exit code 1 when the listener has already gone away.
    if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return [];
    throw new Error(error.code === 'ENOENT' ? '无法检查占用进程：请安装 lsof 后重试。' : `无法检查端口 ${port} 的占用进程。`);
  }
}

function stop(pid, signal, port) {
  try { process.kill(pid, signal); }
  catch (error) {
    if (error.code !== 'ESRCH') throw new Error(`无法停止占用端口 ${port} 的进程 ${pid}，请检查进程权限。`);
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const failed = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
}

/** Only take over the requested TCP port; never kill all Node processes. */
export async function startLocalServer(server, { port, log = console.log, graceMs = 2000, replaceExisting = true } = {}) {
  try { await listen(server, port); return; }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  if (!replaceExisting) throw new Error(`端口 ${port} 已被占用，请检查服务配置；生产服务不会自动停止其他进程。`);

  const pids = await listeningPids(port);
  if (pids.some(pid => pid === process.pid || pid === process.ppid)) throw new Error(`端口 ${port} 被当前启动进程占用，无法自动停止。`);
  if (pids.length) {
    log(`端口 ${port} 已被占用，正在停止进程 ${pids.join('、')}…`);
    for (const pid of pids) stop(pid, 'SIGTERM', port);
    const deadline = Date.now() + graceMs;
    let remaining = pids;
    do {
      await delay(100);
      remaining = (await listeningPids(port)).filter(pid => pids.includes(pid));
    } while (remaining.length && Date.now() < deadline);
    if (remaining.length) {
      log('占用进程未退出，正在强制停止…');
      for (const pid of remaining) stop(pid, 'SIGKILL', port);
      const forceDeadline = Date.now() + 1000;
      do {
        await delay(100);
        remaining = (await listeningPids(port)).filter(pid => remaining.includes(pid));
      } while (remaining.length && Date.now() < forceDeadline);
    }
  }
  try { await listen(server, port); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`端口 ${port} 仍被占用，请关闭占用服务后重试。`);
    throw error;
  }
}
