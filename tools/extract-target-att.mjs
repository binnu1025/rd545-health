// Offline HCI btsnoop extraction. Address is supplied privately, never hardcoded.
import fs from 'node:fs';
const [input, address, output] = process.argv.slice(2);
if (!input || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address ?? '') || !output) throw Error('Usage: node tools/extract-target-att.mjs private-btsnoop.log target-address private-output.json');
const b = fs.readFileSync(input);
if (b.subarray(0,8).toString() !== 'btsnoop\0' || b.readUInt32BE(12) !== 1002) throw Error('Expected HCI UART btsnoop');
const peers = new Map(), partial = new Map(), packets = [], connections = [], errors = [];
let records = 0, offset = 16;
while (offset + 24 <= b.length) {
  const size=b.readUInt32BE(offset+4), flags=b.readUInt32BE(offset+8);
  const time=new Date(Number((b.readBigUInt64BE(offset+16)-0x00dcddb30f2f8000n)/1000n)).toISOString();
  if (offset+24+size>b.length) { errors.push('Truncated HCI record'); break; }
  const p=b.subarray(offset+24,offset+24+size); offset+=24+size; records++;
  if(p[0]===4 && p[1]===0x3e && [1,10].includes(p[3]) && p.length>=15 && p[4]===0) {
    const handle=p.readUInt16LE(5), peer=[...p.subarray(9,15)].reverse().map(v=>v.toString(16).padStart(2,'0')).join(':');
    peers.set(handle,peer);
    if(peer===address.toLowerCase()) connections.push({time,handle});
  }
  if(p[0]===4 && p[1]===5 && p.length>=7) { const handle=p.readUInt16LE(4); peers.delete(handle); for(const key of partial.keys()) if(key.startsWith(handle+'/')) partial.delete(key); }
  if(p[0]!==2 || p.length<5) continue;
  const field=p.readUInt16LE(1),handle=field&4095,pb=(field>>12)&3;
  if(peers.get(handle)!==address.toLowerCase()) continue;
  const direction=flags&1?'RX':'TX', key=handle+'/'+direction;
  if (p.readUInt16LE(3)!==p.length-5) { errors.push('ACL length mismatch'); continue; }
  if(pb===1) {
    const old=partial.get(key); if(!old) { errors.push('Orphan ACL continuation'); continue; }
    old.data=Buffer.concat([old.data,p.subarray(5)]);
  } else partial.set(key,{data:p.subarray(5),time});
  const current=partial.get(key);
  if(current.data.length<4) continue;
  const expected=current.data.readUInt16LE(0)+4;
  if(current.data.length<expected) continue;
  if(current.data.length!==expected) errors.push('L2CAP length mismatch');
  else if(current.data.readUInt16LE(2)===4) packets.push({time:current.time,direction,handle,hex:current.data.subarray(4).toString('hex')});
  partial.delete(key);
}
if(partial.size) errors.push('Incomplete ACL fragments');
fs.writeFileSync(output,JSON.stringify(packets,null,2));
console.log(JSON.stringify({records,connections,attPackets:packets.length,first:packets[0]?.time,last:packets.at(-1)?.time,errors},null,2));
