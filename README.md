# RD-545 Health Manager · Phase 1 BLE LAB

繁體中文、Mobile First、TypeScript + Vite + 原生 Web Bluetooth。

**實驗功能：尚未完成 RD-545 通訊驗證。** 目前交付第一階段，不能自動測量或解碼身體組成。沒有假 UUID、假指令、假資料或已驗證支援的宣稱。Phase 2–7 的訪客、Google Sheets、手動測量與 JPG 報告尚未實作；依原始任務順序，先用實機確認 BLE Lab 可工作。

## 執行

需要 Node.js 22.12+（建議 24）。

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

電腦可用 localhost 測試。Android 經區域網路開啟一般 HTTP 位址不屬於 secure context；請使用 HTTPS 部署網址，或 Chrome USB 遠端偵錯的 localhost port forwarding。iPhone Safari 不支援此 BLE 工作流程。

## GitHub Pages

將此專案放入自己的 GitHub repository，預設分支為 main。Settings → Pages → Source 選擇 GitHub Actions。推送後由 `.github/workflows/pages.yml` 測試、建置及發布 dist。Vite 使用相對 base，支援 repository 子路徑。此交付未建立遠端 repository 或發布網站。

不要提交 BLE session、真實個資或健康資料到 repository。GitHub Pages 僅提供靜態程式檔，本工具沒有後端或資料上傳。依據：https://vite.dev/guide/static-deploy.html

## 使用流程與瀏覽器限制

1. Android Chrome／Windows Chrome 或 Edge／macOS Chrome 開啟 HTTPS 網址，確認 Supported 與 Secure Context: Yes。
2. 如有從實機 BLE 工具或 HCI 分析取得的 Service UUID，輸入完整 128-bit UUID（每行一筆）。不能凭空填入推測值。
3. 按「搜尋藍牙設備」，從瀏覽器選擇器選擇你的設備，確認名稱、ID 與 Connected。
4. 按「探索服務」。Web Bluetooth **只能存取 requestDevice 時授權的服務**；空 UUID 可嘗試連線，但探索會受限制或失敗。無法利用此頁自動繞過授權以發現未知 UUID。新增 UUID 後須重新搜尋並授權。
5. 對支援 read 的特徵按 Read；支援 notify 或 indicate 者按 Subscribe。再次按 Unsubscribe 取消訂閱。
6. 僅在已知指令來源及目的時輸入 HEX，選擇 with response / without response 模式後 Write。寫入前有確認；不會提供預設命令。TX 僅在 API 寫入成功後記錄；without response 不代表設備已執行指令。失敗顯示錯誤，不記錄成成功 TX。
7. 匯出 JSON（session metadata + 原始 packets）或 CSV（封包表），Copy HEX 複製收發方向與 HEX。時間顯示台北，匯出 ISO UTC。

通知訂閱期間再次 Read 可能由瀏覽器觸發 valuechanged，加上讀取結果形成相同 RX；分析時須考慮此情形，不可直接當作兩次測量。連線中斷會清理訂閱；重新連線後需重新探索及訂閱。不會自動重連或送出命令。每次成功選擇新設備即開啟新 session 並清除舊封包，請先匯出。

記憶體最多保留最近 10,000 筆，超出時顯示遺失數量，JSON 提供 droppedPacketCount；畫面只呈現最近 100 筆。Clear Log 會清空記錄，重整或關閉網頁也會丟失資料。本版本不使用 localStorage、Google token 或帳戶資訊。匯出包含設備 ID 與可能敏感的 raw packet，請自行保管。

瀏覽器限制來源：https://developer.chrome.com/docs/capabilities/bluetooth

## 實機驗證紀錄

請在私人位置保存：日期、設備型號／韌體（若可知）、作業系統、瀏覽器版本、UUID 來源、連線結果、服務列表、通知、錯誤及原始檔。不得把私人紀錄提交到 repo。

### Test A — 一般使用者

以 Health Planet 正常測量一次，記錄體重、體脂率、肌肉量與其他可見值以及測量時間。同步使用 Android Bluetooth HCI snoop log 取得 Health Planet 與設備的流量（開發人員選項、裝置廠商可用性可能不同），或使用適當 BLE 記錄工具。一般 BLE 工具與此 Lab 不能旁聽其他 App 已建立的 GATT 連線；也不要假設設備允許同時多個 central。需要切換工具時先關閉 Health Planet 的設備連線。將服務 UUID 和特徵 UUID 依證據填入測試筆記。

### Test B — Guest

啟動 RD-545 Guest 模式。使用已觀察到的服務授權，在 Lab 嘗試連線和訂閱。逐項記錄是否連線、是否出現 Notification、哪些 packet 與 Test A 不同、是否有與顯示值對應的 bytes。沒有找到時寫「未確認」，不要硬解碼。匯出完整 session。

### Test C — 改變單一變數

比較 70.0 kg 與 70.5 kg 等受控測試，對齊同一測量階段的 packet，再找出改變的 bytes。對身高、年齡、性別等設定一次只改一項。體脂率及心率不容易獨立控制，應記錄共同變動及限制，不能把相關性當作解碼證據。重複測試以確認 endian、比例、單位、封包邊界及 checksum；至少多組數值交叉比對後才實作 parser。

### 軟體與實機驗收分開

自動測試驗證 HEX、DataView offset、CSV、記憶體上限與 Adapter 拒絕未驗證操作。**測試通過不代表 RD-545 相容**。實機另驗證：取消選擇、錯誤 UUID、拒絕授權、正常連線、Read、Subscribe / Unsubscribe、已知安全指令寫入、設備關機／斷線、重連、JSON / CSV 內容比對。

## 後續階段與 Google 設定規劃

取得實機證據後再依序進入 App 框架、Google 登入、每人自有 Sheet、訪客、手動輸入及報告。`RD545Adapter` 的所有操作目前一律拋出 `RD-545 protocol not yet verified`，不可替換成模擬成功。

後續 Google Cloud 設定：建立專案，啟用 Sheets API 與 Drive API，設定 OAuth consent screen（測試期間加入測試使用者），建立 Web application OAuth Client ID。Authorized JavaScript origins 加入開發 localhost origin 及 GitHub Pages 的 HTTPS origin（不含 repository 路徑）。GIS 前端使用公開 Client ID，不放 client secret；優先評估只用 drive.file 存取由 App 建立或使用者選取的試算表。token 僅保留記憶體，帳戶切換須清除當前資料並重新確認該帳戶下的 Sheet，不能直接沿用其他帳戶的 spreadsheet ID。健康資料不得存在 localStorage。此階段未實作 OAuth，相關設定會在 Phase 3 依當時官方文件再次確認。

原始需求附件在 Security / Privacy 第 5 點中斷，後續開發前請補齊剩餘要求。
