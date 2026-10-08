// Offline research only. Input/output must remain outside the repository.
// Hypotheses derived from one capture; does not send commands or decode health metrics.
import fs from 'node:fs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/analyze-tanita-att.mjs private-att.json private-analysis.json');
const packets = JSON.parse(fs.readFileSync(input, 'utf8'));
const pending = new Map();
const frames = []; const errors = [];
for (const packet of packets) {
  const att = Buffer.from(packet.hex, 'hex');
  if (![0x52, 0x1b].includes(att[0])) continue;
  const key = `${packet.handle}/${packet.direction}/${att.readUInt16LE(1)}`;
  const p = att.subarray(3);
  if (p.length < 4) { errors.push('Short fragment'); continue; }
  // Observed header: uint16 big-endian byte offset; last index; payload length.
  // The second capture crosses offset 255, disproving the reserved-byte hypothesis.
  const index = p.readUInt16BE(0) / 16, last = p[2], length = p[3];
  if (!Number.isInteger(index) || index > last || length > 16 || p.length < 4 + length) {
    errors.push(`Unrecognized header at ${packet.time}`); continue;
  }
  if (index === 0) {
    if (pending.has(key)) errors.push(`Interrupted frame at ${packet.time}`);
    pending.set(key, {time:packet.time, direction:packet.direction, handle:att.readUInt16LE(1), last, next:0, chunks:[]});
  }
  const frame = pending.get(key);
  if (!frame || frame.next !== index || frame.last !== last) { errors.push(`Missing/out-of-order fragment at ${packet.time}`); pending.delete(key); continue; }
  frame.chunks.push(p.subarray(4,4+length)); frame.next++;
  if (index === last) {
    const body = Buffer.concat(frame.chunks);
    frames.push({time:frame.time,direction:frame.direction,attributeHandle:frame.handle,
      byteLength:body.length,declaredLength:body.length>=2?body.readUInt16BE(0):null,
      lengthMatches:body.length>=2&&body.readUInt16BE(0)===body.length-2,
      sumModulo256:[...body].reduce((sum,b)=>(sum+b)&255,0),
      commandCandidate:body.subarray(2,4).toString('hex'),
      modelMarker:body.includes(Buffer.from('RD-545AS'))?'RD-545AS':null,
      hex:body.toString('hex')});
    pending.delete(key);
  }
}
if(pending.size) errors.push(`${pending.size} incomplete frame(s)`);
fs.writeFileSync(output,JSON.stringify({status:'EXPERIMENTAL_OFFLINE_ONLY',frames,errors},null,2));
// Never print raw bodies: these can contain identifiers and personal profiles.
console.log(JSON.stringify({frames:frames.map(({hex,...summary})=>summary),errors},null,2));
