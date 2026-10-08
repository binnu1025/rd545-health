import { expect, it } from 'vitest';
import { candidateFields, decodeExperimentalResult, ExperimentalAssembler } from '../src/bluetooth/experimentalDecoder';
// Entirely synthetic values, never copied from a person's measurement.
function fixture() {
  const f = new Uint8Array(346); f[0]=1; f[1]=88; f[2]=0xb0; f[3]=0x10; f.set([0x6a,0x32,0x26,0x84,0x6a,0x33,0,0x30,0x0c],6);
  candidateFields.forEach((field,i) => { f[field.offset]=field.tag>>8; f[field.offset+1]=field.tag&255; const raw=100+i; if(field.width===2){f[field.offset+2]=raw>>8;f[field.offset+3]=raw&255;}else f[field.offset+2]=raw; });
  return checksum(f);
}
function checksum(f:Uint8Array) {f[f.length-1]=0;f[f.length-1]=(255-f.reduce((a,b)=>a+b,0))&255;return f;}
function fragments(f:Uint8Array) {
  return Array.from({length:Math.ceil(f.length/16)},(_,i)=>{const size=Math.min(16,f.length-i*16),p=new Uint8Array(20);p[0]=(i*16)>>8;p[1]=(i*16)&255;p[2]=Math.ceil(f.length/16)-1;p[3]=size;p.set(f.subarray(i*16,i*16+size),4);return p;});
}
it('reassembles 22 fragments across the 255-byte offset and decodes synthetic fields',()=>{
  const a=new ExperimentalAssembler();let result:Uint8Array|null=null;
  for(const p of fragments(fixture())) result=a.push(p);
  expect(result).toEqual(fixture());
  expect(decodeExperimentalResult(result!).metrics.map(m=>m.value)).toEqual([1,10.1,1.02,10.3,104]);
  // 0x2684 days after 2000-01-01 = 2026-12-30; 0x300c half-seconds = 01:42:30 Taipei.
  expect(decodeExperimentalResult(result!).measuredAt.toISOString()).toBe("2026-12-29T17:42:30.000Z");
});
it('rejects corrupt checksum, wrong command, length, or shifted tag even with a valid checksum',()=>{
  const corrupt=fixture();corrupt[20]^=1;expect(()=>decodeExperimentalResult(corrupt)).toThrow('校驗');
  const command=fixture();command[2]=0;expect(()=>decodeExperimentalResult(checksum(command))).toThrow('格式');
  const length=fixture();length[1]--;expect(()=>decodeExperimentalResult(length)).toThrow('長度');
  const shifted=fixture();shifted[25]=0;expect(()=>decodeExperimentalResult(checksum(shifted))).toThrow('欄位');
  const noTime=fixture();noTime[10]=0;expect(()=>decodeExperimentalResult(checksum(noTime))).toThrow('量測時間');
});
it('rejects missing/duplicate fragments and can recover after reset',()=>{
  const a=new ExperimentalAssembler(),parts=fragments(fixture());
  a.push(parts[0]);expect(()=>a.push(parts[2])).toThrow();
  a.push(parts[0]);expect(()=>a.push(parts[0])).toThrow();
  let result;for(const p of parts)result=a.push(p);expect(result).toEqual(fixture());
});
it('rejects invalid fragment size and nonzero trailing padding',()=>{
  const a=new ExperimentalAssembler();expect(()=>a.push(Uint8Array.of(0,0,0,0))).toThrow();
  const parts=fragments(fixture());for(const p of parts.slice(0,-1))a.push(p);
  parts.at(-1)![19]=1;expect(()=>a.push(parts.at(-1)!)).toThrow('補齊');
});
