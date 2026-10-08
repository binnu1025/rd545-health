import { BleProbe } from './BleProbe';
import { decodeExperimentalResult, ExperimentalAssembler } from './experimentalDecoder';
import { observedServiceUuid } from './autoReceive';
import { decodeScaleProfile, type ScaleProfile } from './userProfile';
const verifiedSessions = new WeakMap<BleProbe, { generation:number; uuid:string; rx:BluetoothRemoteGATTCharacteristic }>();
const commandNames:Record<number,string>={3:'身分驗證',16:'時間同步',32:'型號讀取',0x1000:'讀取個人資料',0x2010:'開始測量',0x3000:'取得測量筆數',0x3010:'取得測量結果'};
// Official TNTDeviceStatus: 5 = RECEIVE_DATA_ERROR, 7 = SEQUENCE_ERROR.
const statusNames:Record<number,string>={5:'設備回報接收資料錯誤',7:'指令順序錯誤'};
// Records are numbered from 1 (official app sends 1 when count is 1). Cap guards against a corrupt count.
const maxStoredRecords=10;
class ReplyTimeout extends Error {}
// Built from parts: Intl's own separators (e.g. U+2009) differ between browsers.
const formatTaipei=(date:Date)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;};
export function encodeTaipeiClock(date:Date):Uint8Array {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const value=(type:string)=>Number(parts.find(p=>p.type===type)?.value);
  const days=Math.floor((Date.UTC(value('year'),value('month')-1,value('day'))-Date.UTC(2000,0,1))/86400000);
  if(days<0||days>65535)throw Error('日期超出設備可表示範圍');
  const ticks=(value('hour')*3600+value('minute')*60+value('second'))*2;
  return Uint8Array.of(0x6a,0x32,days>>8,days&255,0x6a,0x33,ticks>>16,(ticks>>8)&255,ticks&255);
}
export function encodeProbeCommand(command: number, payload: Uint8Array): Uint8Array[] {
  if (command !== 3 && command !== 16 && command !== 32 && ![0x1000,0x2010,0x3000,0x3010].includes(command)) throw Error('僅允許驗證身分、時間同步與讀取設備資訊');
  const body=new Uint8Array(payload.length+5),size=body.length-2;
  body[0]=size>>8;body[1]=size&255;body[2]=command>>8;body[3]=command&255;body.set(payload,4);
  body[body.length-1]=(255-body.reduce((a,b)=>a+b,0))&255;
  const chunks:Uint8Array[]=[];
  for(let offset=0;offset<body.length;offset+=16){const length=Math.min(16,body.length-offset),p=new Uint8Array(length+4);p[0]=offset>>8;p[1]=offset&255;p[2]=Math.ceil(body.length/16)-1;p[3]=length;p.set(body.subarray(offset,offset+length),4);chunks.push(p);}
  return chunks;
}
/** measure: false = identify only, true = start a new measurement, 'stored' = read results already kept on the scale. */
export type ScaleResult=ReturnType<typeof decodeExperimentalResult>;
export type ScaleStage='verify'|'stand'|'read';
export interface ScaleHooks{stage?:(stage:ScaleStage)=>void;profile?:(profile:ScaleProfile|null)=>void}
export async function identifyScale(probe:BleProbe, appUuid:string, measure:boolean|'stored'|'profile'=false, progress:(text:string)=>void=()=>{}, onResult:(result:ScaleResult,measuredAtText:string,profile:ScaleProfile|null)=>void=()=>{}, hooks:ScaleHooks={}) {
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(appUuid))throw Error('身分檔 UUID 格式錯誤');
  const suffix='-6b90-4779-83b8-b8bf1dadac35';
  const rxKey=observedServiceUuid+'/273e510e'+suffix,txKey=observedServiceUuid+'/273e5107'+suffix;
  const rx=probe.characteristics.get(rxKey),tx=probe.characteristics.get(txKey);
  if(!rx?.properties.notify||!tx?.properties.writeWithoutResponse)throw Error('未找到經核對的 5107／510e 通道');
  if(!probe.subscriptions.has(rxKey))await probe.toggleNotifications(rxKey);
  async function request(command:number,payload:Uint8Array, timeoutMs=8000, acceptStatus=false):Promise<Uint8Array>{
    const assembler=new ExperimentalAssembler();
    let finish:(value:Uint8Array)=>void=()=>{},fail:(error:Error)=>void=()=>{};
    const response=new Promise<Uint8Array>((resolve,reject)=>{finish=resolve;fail=error=>{verifiedSessions.delete(probe);reject(error);};});
    // Mark handled while sequential writes are still in flight.
    void response.catch(()=>{});
    const onValue=()=>{try{if(!rx!.value)return;const v=rx!.value;const frame=assembler.push(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));if(frame){if((frame[2]*256+frame[3])!==(command|0x8000))throw Error('收到非預期回覆，已停止');if(frame[4]!==0&&!acceptStatus)throw Error(`${commandNames[command]??'未知命令'}（0x${command.toString(16).padStart(4,"0")}）：${statusNames[frame[4]]??'設備狀態'}（${frame[4]}），已停止`);finish(frame);}}catch(e){fail(e instanceof Error?e:Error(String(e)));}};
    const disconnected=()=>fail(Error('设备已斷線'));
    rx!.addEventListener('characteristicvaluechanged',onValue);
    probe.device?.addEventListener('gattserverdisconnected',disconnected);
    const timer=setTimeout(()=>fail(new ReplyTimeout(`${commandNames[command]??'未知命令'}（0x${command.toString(16).padStart(4,'0')}）：等待回覆逾時，已停止`)),timeoutMs);
    try{for(const chunk of encodeProbeCommand(command,payload))await probe.write(txKey,chunk,true);return await response;}
    finally{clearTimeout(timer);rx!.removeEventListener('characteristicvaluechanged',onValue);probe.device?.removeEventListener('gattserverdisconnected',disconnected);}
  }
  const session=verifiedSessions.get(probe);
  const alreadyVerified=probe.status==='Connected' && session?.generation===probe.connectionGeneration && session.uuid===appUuid.toLowerCase() && session.rx===rx;
  if(!alreadyVerified) {
  hooks.stage?.('verify');
  const verified=await request(3,new TextEncoder().encode(appUuid.toLowerCase()));
  if(verified.length!==7||verified[5]!==0)throw Error('設備未接受 App 身分；不會覆寫配對');
  const clockReply=await request(16,encodeTaipeiClock(new Date()));
  if(clockReply.length!==7||clockReply[5]!==0)throw Error("設備未接受時間同步，已停止");
  const info=await request(32,Uint8Array.of(0));
  const text=new TextDecoder().decode(info.subarray(5,-1));
  if(!text.includes('RD-545AS'))throw Error('已收到設備資訊，但未確認 RD-545AS 型號');
  verifiedSessions.set(probe,{generation:probe.connectionGeneration,uuid:appUuid.toLowerCase(),rx});
  }
  if(!measure)return '身分驗證與 RD-545AS 型號讀取成功。連線已保留，可直接按「開始測量」，不用中斷。';
  progress('正在讀取設備既有個人資料；不會覆寫設定。');
  const profile=decodeScaleProfile(await request(0x1000,Uint8Array.of(0)));
  hooks.profile?.(profile);
  if(measure==='profile')return profile?'已讀取體脂計裡的個人資料。':'已連線，但無法解讀體脂計裡的個人資料。';
  if(measure!=='stored'){
    hooks.stage?.('stand');
    progress('正在要求設備開始測量。請等體脂計顯示可測量後，依設備提示操作；若資料不是本人，請勿站上。');
    await request(0x2010,Uint8Array.of(0),180000);
    hooks.stage?.('read');
    progress('設備回報量測完成，正在取得結果…');
  } else {hooks.stage?.('read');progress('正在讀取體脂計中已存的結果…');}
  const count=await request(0x3000,Uint8Array.of(0));
  if(count.length!==7)throw Error('測量筆數回覆格式不符，已停止');
  const total=count[5];
  if(total===0)throw Error('體脂計中沒有未讀取的測量結果（筆數 0）');
  if(total>maxStoredRecords)throw Error(`體脂計回報 ${total} 筆，超出預期上限 ${maxStoredRecords}，已停止`);
  // The result carries its own measurement time, so read every stored record and show the newest.
  // Observed on the real scale: an unfinished measurement is counted but answers with status 5 and a zeroed time; skip it.
  const results=[],skipped:string[]=[];
  for(let record=1;record<=total;record++){
    progress(`正在取得第 ${record}／${total} 筆結果…`);
    // Seen on the real scale (2026-10-08): it occasionally ignores one result request while answering every other command.
    // Reading a result changes nothing on the scale, so ask once more before giving up.
    let frame:Uint8Array;
    try{frame=await request(0x3010,Uint8Array.of(record),8000,true);}
    catch(e){if(!(e instanceof ReplyTimeout))throw e;progress(`第 ${record} 筆沒有回應，2 秒後重新要求一次…`);await new Promise(r=>setTimeout(r,2000));
      try{frame=await request(0x3010,Uint8Array.of(record),8000,true);}catch(again){throw again instanceof ReplyTimeout?Error(`${again.message}（已重試一次）`):again;}}
    if(frame[5]!==record)throw Error(`取得測量結果：設備回覆第 ${frame[5]} 筆，與請求的第 ${record} 筆不符，已停止`);
    if(frame[4]!==0){skipped.push(`第 ${record} 筆（${statusNames[frame[4]]??'設備狀態'} ${frame[4]}）`);continue;}
    results.push(decodeExperimentalResult(frame));
  }
  if(!results.length)throw Error(`取得測量結果（0x3010）：${total} 筆皆無法讀取：${skipped.join('、')}，已停止`);
  const latest=results.reduce((a,b)=>b.measuredAt>a.measuredAt?b:a);
  const others=results.filter(r=>r!==latest).map(r=>formatTaipei(r.measuredAt));
  onResult(latest,formatTaipei(latest.measuredAt),profile);
  return [latest.notice,`量測時間：${formatTaipei(latest.measuredAt)}（台北時間）`,...latest.metrics.map(m=>`${m.label}：${m.value} ${m.unit}`),
    ...(total>1?[`體脂計中共 ${total} 筆，以上為最新的有效結果。`]:[]),
    ...(others.length?[`其他有效結果的量測時間：${others.join('、')}`]:[]),
    ...(skipped.length?[`略過無效紀錄：${skipped.join('、')}`]:[])].join('\n');
}


