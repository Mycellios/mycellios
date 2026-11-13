import {setTimeout} from 'node:timers/promises';

// Keep the license for the exact packaged runtime. Retry transient network
// failures; never substitute another version or silently omit the license.
export async function fetchNodeRuntimeLicense(version,{request=fetch,sleep=setTimeout}={}) {
  if(!/^v\d+\.\d+\.\d+$/.test(version))throw Error('Invalid Node runtime version');
  const url=`https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`;
  for(let attempt=0;attempt<3;attempt++) {
    let response;
    try{response=await request(url,{signal:AbortSignal.timeout(30_000)});}
    catch(error){if(attempt===2)throw error;await sleep(1000*(attempt+1));continue;}
    if(!response.ok){
      if((response.status>=500||[408,429].includes(response.status))&&attempt<2){await response.body?.cancel();await sleep(1000*(attempt+1));continue;}
      throw Error(`Could not retain the Node runtime license (HTTP ${response.status})`);
    }
    const text=await response.text();
    if(!text.includes('Node.js is licensed for use as follows:'))throw Error('Invalid Node runtime license response');
    return text;
  }
}
