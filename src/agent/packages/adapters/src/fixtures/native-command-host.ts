import { startHostComputerServer } from "../host-computer-server.js";
const host=await startHostComputerServer({root:process.argv[2]!,token:"a1".repeat(32),hostname:"127.0.0.1"});
host.setEnabled(true);
process.stdout.write(JSON.stringify({port:host.port})+"\n");
