import type { BleProbe } from '../bluetooth/BleProbe';
import { identifyScale } from '../bluetooth/identityProbe';
import { observedServiceUuid } from '../bluetooth/autoReceive';
import { renderBodyComposition } from './bodyFigure';
import { ageAt } from '../bluetooth/userProfile';
import { mountPeoplePanel } from './peoplePanel';
import { loadRememberedUuid, rememberUuid } from '../storage/deviceSetup';
export function mountIdentityTest(root:HTMLElement,probe:BleProbe,run:(op:()=>Promise<void>,success:string)=>Promise<void>,render:()=>void){
  const section=document.createElement('section');section.className='card';
  section.innerHTML='<h2>實驗：驗證身分與讀取型號</h2><p>匯入這台設備的私人身分檔後，按一次測試。依序驗證既有 App UUID、同步目前台北時間、讀取型號。不修改個人設定或啟動測量。</p><label>私人身分檔<input type="file" accept=".json"></label><button disabled>同步時間並驗證型號</button><p role="status">尚未載入身分檔。檔案僅留在記憶體，重新整理後清除。</p>';
  root.prepend(section);let uuid=loadRememberedUuid()??'';const people=mountPeoplePanel(root,()=>uuid);const input=section.querySelector('input')!,button=section.querySelector('button')!,status=section.querySelector<HTMLElement>('[role=status]')!;
  // A phone that imported a setup code remembers the identity, so no file is needed there.
  if(uuid){button.disabled=false;status.textContent='已使用這台裝置記住的身分（來自手機設定碼），不需載入身分檔。';const forget=document.createElement('button');forget.className='quiet';forget.textContent='清除這台裝置記住的身分';forget.onclick=()=>{if(!confirm('清除後需要重新貼設定碼或載入身分檔才能連線。要繼續嗎？'))return;rememberUuid(null);uuid='';button.disabled=true;forget.remove();status.textContent='已清除。請載入身分檔或重新貼設定碼。';};status.after(forget);}
  input.onchange=async()=>{uuid='';button.disabled=true;try{const file=input.files?.[0];if(!file)return;if(file.size>2048)throw Error('請選擇小型私人身分檔，非診斷壓縮檔');const data=JSON.parse(await file.text());if(data.purpose!=='RD545_IDENTITY_PROBE'||typeof data.appUuid!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.appUuid))throw Error('身分檔格式錯誤');uuid=data.appUuid;button.disabled=false;status.textContent='身分檔已載入。請中斷手機 App 的藍牙連線，再按測試。';}catch(e){status.textContent=String(e);}};
  button.onclick=()=>void run(async()=>{button.disabled=true;status.textContent='正在測試，請等待…';try{if(probe.status!=='Connected')await probe.connect([observedServiceUuid]);if(!probe.characteristics.size)await probe.enumerate();status.textContent=await identifyScale(probe,uuid);}catch(e){status.textContent=String(e);throw e;}finally{button.disabled=!uuid;render();}},'型號測試完成，請查看頁面最上方結果。');
  const consent=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.style.width='auto';
  consent.append(checkbox,document.createTextNode(' 我是目前设备個人資料的本人，使用既有設定進行實驗測量（非 Guest）。'));
  const measure=document.createElement('button');measure.textContent='實驗：連線並開始測量';measure.className='secondary';
  const stored=document.createElement('button');stored.textContent='讀取體脂計中已存的結果（不需重新測量）';stored.className='secondary';
  const note=document.createElement('p');note.className='hint';note.textContent='此流程尚未通過實機測量驗證，可能因缺少個人設定交換而被設備拒絕。失敗即停止，不會覆寫個人資料，並保留連線以便直接讀取已存結果。請由待機 TNT_BW 連線，不要長按配對。';
  const report=document.createElement('div');
  status.style.whiteSpace='pre-wrap';section.append(consent,measure,stored,note,report);
  // Failures keep the connection: disconnecting powers the scale off and its stored results would need a new session.
  const start=(mode:true|'stored')=>{
    if(!uuid){status.textContent='身分檔尚未成功載入。請選擇有效的 identity-probe.json，等待顯示「身分檔已載入」。';input.focus();return;}
    if(!checkbox.checked){status.textContent='身分檔已載入。尚未勾選下方「我是目前設備個人資料的本人」；若資料是你本人，請勾選後再繼續。';checkbox.focus();return;}
    void run(async()=>{measure.disabled=stored.disabled=button.disabled=input.disabled=true;report.replaceChildren();try{if(probe.status!=='Connected')await probe.connect([observedServiceUuid]);if(!probe.characteristics.size)await probe.enumerate();status.textContent=await identifyScale(probe,uuid,mode,text=>{status.textContent=text;},(result,when,profile)=>{if(!result.detail)return;const detail=result.detail,saved=document.createElement('p');saved.className='save-status';saved.textContent='正在存到 Google 試算表…';report.replaceChildren(saved,renderBodyComposition(detail,when,profile&&{sex:profile.sex,age:ageAt(profile.birthDate,result.measuredAt),heightCm:profile.heightCm}));void people.saveResult(result.measuredAt,detail).then(text=>{saved.textContent=text;});});}catch(e){status.textContent=String(e);throw e;}finally{measure.disabled=stored.disabled=input.disabled=false;button.disabled=!uuid;render();}},mode==='stored'?'已讀取體脂計中的結果，顯示於頁面最上方。':'實驗測量流程完成，結果顯示於頁面最上方。');
  };
  measure.onclick=()=>start(true);
  stored.onclick=()=>start('stored');
}

