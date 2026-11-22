import { shellQuote } from "@mycellios/core/node/desktop-runtime";

// Runs inside the existing computer/run marker wrapper. The child inherits that
// marker, so ordinary Stop/revocation still finds it, including across sessions.
const WATCH_SEARCH = String.raw`
import sys,os,json,time,signal,selectors,subprocess,re,collections
c=json.loads(sys.argv[1]);initial=c['initialMs']/1000;hard=time.monotonic()+c['maxMs']/1000;deadline=min(hard,time.monotonic()+initial)
seen=collections.OrderedDict();pending=b'';child=None;finished=False
def stop():
 global child
 if child is None:return
 signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
 owned=child;child=None
 try:os.killpg(owned.pid,signal.SIGTERM)
 except ProcessLookupError:return
 try:owned.wait(timeout=.2)
 except subprocess.TimeoutExpired:
  try:os.killpg(owned.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  owned.wait()
def interrupted(sig,frame):raise KeyboardInterrupt()
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
try:
 child=subprocess.Popen(['bash','-lc',c['command']],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,close_fds=False)
 selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ,1);selector.register(child.stderr,selectors.EVENT_READ,2)
 while selector.get_map():
  remaining=deadline-time.monotonic()
  if remaining<=0:
   stop();sys.stderr.write('Search stopped at its idle or maximum budget. Narrow the project path or pattern; partial results do not prove absence.\n');sys.exit(124)
  for key,mask in selector.select(min(remaining,.1)):
   data=os.read(key.fileobj.fileno(),65536)
   if not data:selector.unregister(key.fileobj);continue
   os.write(key.data,data)
   if key.data!=1:continue
   pending+=data;lines=pending.split(b'\n');pending=lines.pop()[-4096:]
   for raw in lines:
    line=re.sub(r'\x1b\[[0-9;]*m','',raw.decode('utf8','replace')).strip()
    match=re.match(r'^((?:[a-zA-Z]:)?[^:\r\n]+?)(?::(\d+)(?::|$)|:|$)',line)
    if not match:continue
    file=match[1].replace('\\','/');file=file[2:] if file.startswith('./') else file
    if len(file)>4096 or not re.search(r'/|\.[\w-]+$',file):continue
    if not any(root=='.' or file==root or file.startswith(root+'/') for root in c['roots']):continue
    location=file+':'+(match[2] or '')
    if location in seen:continue
    if len(seen)>=2048:seen.popitem(last=False)
    seen[location]=True;deadline=min(hard,time.monotonic()+initial)
 try:code=child.wait(timeout=max(0,deadline-time.monotonic()))
 except subprocess.TimeoutExpired:
  stop();sys.stderr.write('Search stopped at its budget after output closed; partial results do not prove absence.\n');sys.exit(124)
 finished=True;sys.exit(code if code>=0 else 128-code)
except KeyboardInterrupt:sys.exit(130)
finally:
 if not finished:stop()
`;

/** Image-owned Python; source and user command travel as separate quoted arguments. */
export function dockerAdaptiveSearchCommand(command: string, initialMs: number, progress: { maxMs: number; roots: string[] }) {
  return `exec /usr/bin/python3 -u -c ${shellQuote(WATCH_SEARCH)} ${shellQuote(JSON.stringify({ command, initialMs, ...progress }))}`;
}
