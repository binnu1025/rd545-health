import { expect, it, vi } from 'vitest';
import { encodeProbeCommand, encodeTaipeiClock, identifyScale } from '../src/bluetooth/identityProbe';
import type { BleProbe } from '../src/bluetooth/BleProbe';
import { observedServiceUuid } from '../src/bluetooth/autoReceive';
import { candidateFields, ExperimentalAssembler } from '../src/bluetooth/experimentalDecoder';
it('encodes Taipei day and half-second count independently of host timezone',()=>{
  expect([...encodeTaipeiClock(new Date('1999-12-31T16:00:00Z'))]).toEqual([106,50,0,0,106,51,0,0,0]);
  expect([...encodeTaipeiClock(new Date('2000-01-01T16:00:01Z'))]).toEqual([106,50,0,1,106,51,0,0,2]);
});
it('encodes a synthetic UUID with valid framing and checksum',()=>{
  const payload=new TextEncoder().encode('00000000-0000-4000-8000-000000000000');
  const parts=encodeProbeCommand(3,payload),a=new ExperimentalAssembler();let frame:Uint8Array|null=null;
  for(const part of parts)frame=a.push(part);
  expect(parts).toHaveLength(3);expect(frame!.slice(4,-1)).toEqual(payload);expect(frame![3]).toBe(3);
});
it('matches observed device-info command and refuses mutation/measurement commands',()=>{
  expect([...encodeProbeCommand(32,Uint8Array.of(0))[0]]).toEqual([0,0,0,6,0,4,0,32,0,219]);
  for(const command of [2,4098,4099])expect(()=>encodeProbeCommand(command,Uint8Array.of(0))).toThrow();
});
it('reuses verification on the same connection but verifies again after reconnect',async()=>{
  const rx=Object.assign(new EventTarget(),{properties:{notify:true},value:new DataView(new ArrayBuffer(0))});
  const suffix='-6b90-4779-83b8-b8bf1dadac35',rxKey=observedServiceUuid+'/273e510e'+suffix;
  const sent:number[]=[],assembler=new ExperimentalAssembler();
  const probe={status:'Connected',connectionGeneration:1,device:new EventTarget(),
    characteristics:new Map<string,unknown>([[rxKey,rx],[observedServiceUuid+'/273e5107'+suffix,{properties:{writeWithoutResponse:true}}]]),
    subscriptions:new Map([[rxKey,()=>{}]]),
    async write(_key:string,chunk:Uint8Array){
      const request=assembler.push(chunk);if(!request)return;const command=request[2]*256+request[3];sent.push(command);
      if(command===0x2010)throw Error('synthetic stop before measurement');
      const payload=command===32?new TextEncoder().encode('RD-545AS'):Uint8Array.of(0);
      const frame=new Uint8Array(payload.length+6);frame[1]=frame.length-2;frame[2]=(command>>8)|128;frame[3]=command&255;frame.set(payload,5);frame[frame.length-1]=(255-frame.reduce((a,b)=>a+b,0))&255;
      const notification=new Uint8Array(frame.length+4);notification[3]=frame.length;notification.set(frame,4);rx.value=new DataView(notification.buffer);rx.dispatchEvent(new Event('characteristicvaluechanged'));
    },
  } as unknown as BleProbe;
  const uuid='00000000-0000-4000-8000-000000000000';
  await identifyScale(probe,uuid);await identifyScale(probe,uuid);
  expect(sent).toEqual([3,16,32]);
  await expect(identifyScale(probe,uuid,true)).rejects.toThrow('synthetic stop');
  expect(sent).toEqual([3,16,32,0x1000,0x2010]);
  probe.connectionGeneration++;
  await identifyScale(probe,uuid);
  expect(sent.slice(-3)).toEqual([3,16,32]);
});
it('encodes the result request exactly like the official app (record number 1)',()=>{
  const a=new ExperimentalAssembler();let frame:Uint8Array|null=null;
  for(const part of encodeProbeCommand(0x3010,Uint8Array.of(1)))frame=a.push(part);
  expect([...frame!]).toEqual([0x00,0x04,0x30,0x10,0x01,0xba]);
});
// Entirely synthetic values, never copied from a person's measurement.
const day=(Date.UTC(2026,9,8)-Date.UTC(2000,0,1))/86400000,at=(h:number,m:number,s:number)=>(h*3600+m*60+s)*2;
function syntheticResult(halfSeconds=at(1,42,30),base=100){
  const f=new Uint8Array(346);f[0]=1;f[1]=88;f[2]=0xb0;f[3]=0x10;
  f.set([0x6a,0x32,day>>8,day&255,0x6a,0x33,halfSeconds>>16,(halfSeconds>>8)&255,halfSeconds&255],6);
  candidateFields.forEach((field,i)=>{f[field.offset]=field.tag>>8;f[field.offset+1]=field.tag&255;const raw=base+i;if(field.width===2){f[field.offset+2]=raw>>8;f[field.offset+3]=raw&255;}else f[field.offset+2]=raw;});
  f[f.length-1]=(255-f.reduce((a,b)=>a+b,0))&255;return f;
}
function measuringProbe(statusFor:(command:number,record?:number)=>number=()=>0,records=[syntheticResult()],ignoreResults=0){
  const rx=Object.assign(new EventTarget(),{properties:{notify:true},value:new DataView(new ArrayBuffer(0))});
  const suffix='-6b90-4779-83b8-b8bf1dadac35',rxKey=observedServiceUuid+'/273e510e'+suffix;
  const sent:{command:number;payload:number[]}[]=[],assembler=new ExperimentalAssembler();
  let notifications=0;
  const notify=(frame:Uint8Array)=>{for(let offset=0;offset<frame.length;offset+=16){const size=Math.min(16,frame.length-offset),p=new Uint8Array(20);p[0]=offset>>8;p[1]=offset&255;p[2]=Math.ceil(frame.length/16)-1;p[3]=size;p.set(frame.subarray(offset,offset+size),4);rx.value=new DataView(p.buffer);notifications++;rx.dispatchEvent(new Event('characteristicvaluechanged'));}};
  const probe={status:'Connected',connectionGeneration:1,device:new EventTarget(),
    characteristics:new Map<string,unknown>([[rxKey,rx],[observedServiceUuid+'/273e5107'+suffix,{properties:{writeWithoutResponse:true}}]]),
    subscriptions:new Map([[rxKey,()=>{}]]),
    async write(_key:string,chunk:Uint8Array){
      const request=assembler.push(chunk);if(!request)return;const command=request[2]*256+request[3];
      sent.push({command,payload:[...request.slice(4,-1)]});notifications=0;
      // Like the real scale: the result echoes the record number, and a rejected record still sends a full frame.
      if(command===0x3010&&ignoreResults>0){ignoreResults--;return;}
      if(command===0x3010&&records[request[4]-1]){const f=records[request[4]-1].slice();f[4]=statusFor(command,request[4]);f[5]=request[4];f[f.length-1]=0;f[f.length-1]=(255-f.reduce((a,b)=>a+b,0))&255;notify(f);return;}
      const payload=command===32?new TextEncoder().encode('RD-545AS'):Uint8Array.of(command===0x3000?records.length:0);
      const frame=new Uint8Array(payload.length+6);frame[1]=frame.length-2;frame[2]=(command>>8)|128;frame[3]=command&255;frame[4]=statusFor(command);frame.set(payload,5);frame[frame.length-1]=(255-frame.reduce((a,b)=>a+b,0))&255;
      notify(frame);
    },
  } as unknown as BleProbe;
  return {probe,sent,notifications:()=>notifications};
}
const uuid='00000000-0000-4000-8000-000000000000';
it('runs the full synthetic measurement flow and requests result record 1',async()=>{
  const {probe,sent,notifications}=measuringProbe();
  const text=await identifyScale(probe,uuid,true);
  expect(sent.map(s=>s.command)).toEqual([3,16,32,0x1000,0x2010,0x3000,0x3010]);
  expect(sent.find(s=>s.command===0x3000)!.payload).toEqual([0]);
  expect(sent.find(s=>s.command===0x3010)!.payload).toEqual([1]);
  expect(notifications()).toBe(22);
  expect(text).toContain('量測時間：2026-10-08 01:42:30');
  expect(text).toContain('體重：1 kg');
  expect(text).toContain('肌肉品質：104 分');
});
it('reads every stored record and shows the newest by measurement time',async()=>{
  // Record 1 is deliberately the newer one so the choice cannot depend on record order.
  const {probe,sent}=measuringProbe(undefined,[syntheticResult(at(1,42,30),200),syntheticResult(at(0,55,0),100)]);
  const text=await identifyScale(probe,uuid,true);
  expect(sent.filter(s=>s.command===0x3010).map(s=>s.payload)).toEqual([[1],[2]]);
  expect(text).toContain('量測時間：2026-10-08 01:42:30');
  expect(text).toContain('體重：2 kg');
  expect(text).toContain('共 2 筆');
  expect(text).toContain('00:55:00');
});
it('reads stored results without starting a new measurement',async()=>{
  const {probe,sent}=measuringProbe();
  await identifyScale(probe,uuid,'stored');
  expect(sent.map(s=>s.command)).toEqual([3,16,32,0x1000,0x3000,0x3010]);
  const {probe:empty}=measuringProbe(undefined,[]);
  await expect(identifyScale(empty,uuid,'stored')).rejects.toThrow('沒有未讀取的測量結果');
});
it('names the failing stage and status when the device rejects the result request',async()=>{
  const {probe}=measuringProbe(command=>command===0x3010?5:0);
  await expect(identifyScale(probe,uuid,true))
    .rejects.toThrow('取得測量結果（0x3010）：1 筆皆無法讀取：第 1 筆（設備回報接收資料錯誤 5），已停止');
  const {probe:early}=measuringProbe(command=>command===0x3000?7:0);
  await expect(identifyScale(early,uuid,true))
    .rejects.toThrow('取得測量筆數（0x3000）：指令順序錯誤（7），已停止');
});
it('skips a counted record the scale rejects (status 5, zeroed time) and shows the valid one',async()=>{
  // Mirrors the real 2026-10-08 session: count 2, record 1 valid, record 2 rejected with an empty timestamp.
  const empty=syntheticResult(0,100);empty.fill(0,8,10);
  const {probe,sent}=measuringProbe((command,record)=>command===0x3010&&record===2?5:0,[syntheticResult(at(7,15,0),200),empty]);
  const text=await identifyScale(probe,uuid,'stored');
  expect(sent.filter(s=>s.command===0x3010).map(s=>s.payload)).toEqual([[1],[2]]);
  expect(text).toContain('量測時間：2026-10-08 07:15:00');
  expect(text).toContain('體重：2 kg');
  expect(text).toContain('略過無效紀錄：第 2 筆（設備回報接收資料錯誤 5）');
});
it('asks once more when the scale ignores a result request, then reports the stage if it stays silent',async()=>{
  vi.useFakeTimers();
  try{
    const {probe,sent}=measuringProbe(undefined,undefined,1);
    const ok=identifyScale(probe,uuid,'stored');
    await vi.advanceTimersByTimeAsync(10500);
    expect(await ok).toContain('量測時間：2026-10-08 01:42:30');
    expect(sent.filter(s=>s.command===0x3010).map(s=>s.payload)).toEqual([[1],[1]]);
    const {probe:silent}=measuringProbe(undefined,undefined,2);
    const failed=expect(identifyScale(silent,uuid,'stored')).rejects.toThrow('取得測量結果（0x3010）：等待回覆逾時，已停止（已重試一次）');
    await vi.advanceTimersByTimeAsync(20000);
    await failed;
  }finally{vi.useRealTimers();}
});
