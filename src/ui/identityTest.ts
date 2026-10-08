import type { BleProbe } from '../bluetooth/BleProbe';
import { identifyScale } from '../bluetooth/identityProbe';
import { observedServiceUuid } from '../bluetooth/autoReceive';
import { renderBodyComposition } from './bodyFigure';
import { ageAt } from '../bluetooth/userProfile';
import { mountPeoplePanel } from './peoplePanel';
import { loadRememberedUuid, rememberUuid } from '../storage/deviceSetup';
const scaleNamePrefix='TNT_BW';
const consentKey='rd545.ownerConsent';
const loadConsent=()=>{try{return localStorage.getItem(consentKey)==='1';}catch{return false;}};
const rememberConsent=(v:boolean)=>{try{if(v)localStorage.setItem(consentKey,'1');else localStorage.removeItem(consentKey);}catch{/* visit-only */}};
export function mountIdentityTest(root:HTMLElement,probe:BleProbe,run:(op:()=>Promise<void>,success:string)=>Promise<void>,render:()=>void){
  const section=document.createElement('section');section.className='card identity';
  section.innerHTML='<h2>體脂計身分</h2><p class="hint">網頁用這個身分向體脂計證明是你的手機或電腦。電腦每次打開網頁載入一次；手機貼過設定碼就不用。</p><label>身分檔（identity-probe.json）<input type="file" accept=".json"></label><p role="status">尚未載入身分檔。檔案只留在這個分頁的記憶體，重新整理後清除。</p><details class="advanced"><summary>進階：手動測試</summary><button disabled>同步時間並驗證型號</button></details>';
  root.prepend(section);let uuid=loadRememberedUuid()??'';const people=mountPeoplePanel(root,()=>uuid);const input=section.querySelector('input')!,button=section.querySelector('button')!,status=section.querySelector<HTMLElement>('[role=status]')!;
  // A phone that imported a setup code remembers the identity, so no file is needed there.
  if(uuid){button.disabled=false;status.textContent='已使用這台裝置記住的身分（來自手機設定碼），不需載入身分檔。';const forget=document.createElement('button');forget.className='quiet';forget.textContent='清除這台裝置記住的身分';forget.onclick=()=>{if(!confirm('清除後需要重新貼設定碼或載入身分檔才能連線。要繼續嗎？'))return;rememberUuid(null);uuid='';button.disabled=true;forget.remove();status.textContent='已清除。請載入身分檔或重新貼設定碼。';};status.after(forget);}
  input.onchange=async()=>{uuid='';button.disabled=true;try{const file=input.files?.[0];if(!file)return;if(file.size>2048)throw Error('請選擇小型私人身分檔，非診斷壓縮檔');const data=JSON.parse(await file.text());if(data.purpose!=='RD545_IDENTITY_PROBE'||typeof data.appUuid!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.appUuid))throw Error('身分檔格式錯誤');uuid=data.appUuid;button.disabled=false;say('身分檔已載入。按上方「一鍵讀取最新結果」即可。');}catch(e){status.textContent=String(e);}};
  button.onclick=()=>void run(async()=>{button.disabled=true;status.textContent='正在測試，請等待…';try{if(probe.status!=='Connected')await probe.connect([observedServiceUuid],scaleNamePrefix);if(!probe.characteristics.size)await probe.enumerate();status.textContent=await identifyScale(probe,uuid);}catch(e){status.textContent=String(e);throw e;}finally{button.disabled=!uuid;render();}},'型號測試完成，請查看頁面最上方結果。');
  const consent=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.style.width='auto';
  consent.append(checkbox,document.createTextNode(' 我是目前设备個人資料的本人，使用既有設定進行實驗測量（非 Guest）。'));
  const measure=document.createElement('button');measure.textContent='實驗：連線並開始測量';measure.className='secondary';
  const stored=document.createElement('button');stored.textContent='讀取體脂計中已存的結果（不需重新測量）';stored.className='secondary';
  const note=document.createElement('p');note.className='hint';note.textContent='此流程尚未通過實機測量驗證，可能因缺少個人設定交換而被設備拒絕。失敗即停止，不會覆寫個人資料，並保留連線以便直接讀取已存結果。請由待機 TNT_BW 連線，不要長按配對。';
  const report=document.createElement('div');
  checkbox.checked=loadConsent();checkbox.onchange=()=>rememberConsent(checkbox.checked);
  // One-tap bar at the very top: connect, verify, read, save, and show the result right there.
  const quick=document.createElement('section');quick.className='card quick';
  const quickRead=document.createElement('button');quickRead.className='big';quickRead.textContent='一鍵讀取最新結果';
  const quickMeasure=document.createElement('button');quickMeasure.className='secondary';quickMeasure.textContent='開始新的量測';
  const quickStatus=document.createElement('p');quickStatus.setAttribute('role','status');quickStatus.className='quick-status';
  quickStatus.textContent=uuid?'體脂計待機即可，按一下就會連線並讀取。':'請先在下方載入身分檔，或在手機貼上設定碼。';
  const quickActions=document.createElement('div');quickActions.className='actions';quickActions.append(quickRead,quickMeasure);
  quick.append(quickActions,quickStatus,report);root.prepend(quick);
  status.style.whiteSpace='pre-wrap';section.querySelector('.advanced')!.append(consent,measure,stored,note);
  // Failures keep the connection: disconnecting powers the scale off and its stored results would need a new session.
  const say=(text:string)=>{status.textContent=text;quickStatus.textContent=text;};
  const start=(mode:true|'stored')=>{
    if(!uuid){say('身分檔尚未成功載入。請選擇有效的 identity-probe.json，或在手機貼上設定碼。');input.focus();return;}
    if(!checkbox.checked){
      // Asked once per device, then remembered, so the quick button stays a single tap.
      if(!confirm('確認：你是體脂計裡設定的本人，要用既有設定讀取或量測（非 Guest）？')){say('已取消。');return;}
      checkbox.checked=true;rememberConsent(true);
    }
    void run(async()=>{
      measure.disabled=stored.disabled=button.disabled=input.disabled=quickRead.disabled=quickMeasure.disabled=true;report.replaceChildren();
      try{
        if(probe.status!=='Connected'){say('正在連線體脂計…');await probe.connect([observedServiceUuid],scaleNamePrefix);}
        if(!probe.characteristics.size)await probe.enumerate();
        say(await identifyScale(probe,uuid,mode,say,(result,when,profile)=>{
          if(!result.detail)return;
          const detail=result.detail,saved=document.createElement('p');saved.className='save-status';saved.textContent='正在存到 Google 試算表…';
          report.replaceChildren(saved,renderBodyComposition(detail,when,profile&&{sex:profile.sex,age:ageAt(profile.birthDate,result.measuredAt),heightCm:profile.heightCm}));
          void people.saveResult(result.measuredAt,detail).then(text=>{saved.textContent=text;});
        }));
      }catch(e){say(String(e));throw e;}
      finally{measure.disabled=stored.disabled=input.disabled=quickRead.disabled=quickMeasure.disabled=false;button.disabled=!uuid;render();}
    },mode==='stored'?'已讀取體脂計中的結果。':'量測流程完成。');
  };
  quickRead.onclick=()=>start('stored');
  quickMeasure.onclick=()=>start(true);
  measure.onclick=()=>start(true);
  stored.onclick=()=>start('stored');
}

