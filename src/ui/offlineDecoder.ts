import { decodeSession } from '../bluetooth/decodeSession';
export function mountOfflineDecoder(root: HTMLElement) {
  const section=document.createElement('section'); section.className='card';
  section.innerHTML='<h2>實驗性結果解碼</h2><p>匯入已保存的封包，在本機顯示五項候選數值。不需連接體脂計。</p><label>選擇 BLE Lab／ATT JSON<input type="file" accept=".json,application/json"></label><button class="secondary" type="button">清除結果</button><p role="status">僅通過一份實測樣本比對；尚未完成正式通訊驗證。檔案不會上傳或儲存至瀏覽器。</p><div class="decoded-output"></div>';
  root.append(section);
  const input=section.querySelector('input')!, status=section.querySelector<HTMLElement>('[role=status]')!, output=section.querySelector<HTMLElement>('.decoded-output')!;
  let generation=0;
  section.querySelector('button')!.onclick=()=>{generation++;input.value='';output.replaceChildren();status.textContent='已清除。';};
  input.onchange=async()=>{
    const current=++generation,file=input.files?.[0];output.replaceChildren();if(!file)return;
    try{
      if(file.size>20*1024*1024)throw Error('檔案超過 20 MB，請使用篩選後的 JSON。');
      const data=JSON.parse(await file.text());if(current!==generation)return;
      const {results,errors}=decodeSession(data);
      status.textContent=`找到 ${results.length} 個可辨識結果；${errors.length} 個封包問題。這是實驗性候選值，請與設備比對。`;
      for(const item of results.slice(-20)){
        const card=document.createElement('article');card.className='characteristic';
        const title=document.createElement('p');title.textContent=`實驗性結果 · ${item.timestamp}`;card.append(title);
        const list=document.createElement('dl');
        for(const metric of item.result.metrics){const label=document.createElement('dt'),value=document.createElement('dd');label.textContent=metric.label;value.textContent=`${metric.value} ${metric.unit}`;list.append(label,value);}
        card.append(list);output.append(card);
      }
      if(errors.length){const detail=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='封包問題';text.textContent=errors.slice(0,10).join('；');detail.append(summary,text);output.append(detail);}
    }catch(error){if(current===generation)status.textContent=error instanceof Error?error.message:String(error);}
  };
}
