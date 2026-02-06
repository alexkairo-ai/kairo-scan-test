const API_URL = 'https://script.google.com/macros/s/AKfycbxkd82t9NGFfboV2FDy7klyIyLoBK-3Vlzo7z9vNEUVabG5EsEP3SqJuiOyRfs5zeFeMw/exec';
const EDIT_PASS = '1990';
const PHOTO_ROOT_URL = 'https://drive.google.com/drive/folders/1zk8c6qGUBNcVQAUlucU5cedBKIQNu5GZ';
const photoStages = new Set(['hdf','prisadka','upakovka']);

const orderInput = document.getElementById("order");
const workerInput = document.getElementById("worker");
const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const startBtn = document.getElementById("startCam");
const msg = document.getElementById("msg");
const stageTitle = document.getElementById("stageTitle");

const mainView = document.getElementById("mainView");
const reportsView = document.getElementById("reportsView");
const openReportsBtn = document.getElementById("openReports");
const closeReportsBtn = document.getElementById("closeReports");
const reportsStatus = document.getElementById("reportsStatus");
const reportsTableBody = document.querySelector("#reportsTable tbody");
const editReportsBtn = document.getElementById("editReports");
const openPhotoStoreBtn = document.getElementById("openPhotoStore");

const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const statsDate = document.getElementById("statsDate");
const statsStage = document.getElementById("statsStage");
const statsBtn = document.getElementById("statsBtn");
const statsResult = document.getElementById("statsResult");

const pdfFrom = document.getElementById("pdfFrom");
const pdfTo = document.getElementById("pdfTo");
const exportPdfBtn = document.getElementById("exportPdf");

const printArea = document.getElementById("printArea");

let stream=null, locked=false, starting=false, stopTimer=null, editMode=false;
let rawReports=[], currentReports=[], filterTerm='', sortMode='time_desc';
let reportsTimer=null, reportsLoading=false, currentFilter='day';

const deletedTombstones = new Map();
function reportId(r){ return String(r.db || '') + ':' + String(r.row || ''); }

function isStreamActive(){ return stream && stream.getTracks().some(t => t.readyState==="live"); }
function showScanButton(show){ startBtn.style.display = show ? "block" : "none"; }
function stopCamera(){ if(stream) stream.getTracks().forEach(t=>t.stop()); stream=null; if(stopTimer){clearTimeout(stopTimer);stopTimer=null;} showScanButton(true); }
function freezeCamera(){ if(stream) stream.getTracks().forEach(t=>t.stop()); locked=true; if(stopTimer){clearTimeout(stopTimer);stopTimer=null;} showScanButton(true); }

/* автозаполнение имени */
const savedName = localStorage.getItem('workerName') || '';
if(savedName) workerInput.value = savedName;
workerInput.addEventListener('input', ()=>localStorage.setItem('workerName', workerInput.value.trim()));

async function startCamera(){
 if (starting) return;
 starting = true;
 try{
 stream = await navigator.mediaDevices.getUserMedia({
 video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},
 audio:false });
 }catch(e1){
 try{
 stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
 }catch(e2){
 msg.innerHTML="Камера не запустилась. Проверьте HTTPS, доступ и закрытие других приложений.";
 console.log(e1, e2);
 showScanButton(true);
 starting = false;
 return;
 }
 }

 try{
 video.srcObject = stream;
 await video.play();
 locked=false; showScanButton(false);
 if (stopTimer) clearTimeout(stopTimer);
 stopTimer = setTimeout(()=>{ if(!locked){ msg.innerHTML="Сканирование остановлено. Нажмите «СКАНИРОВАТЬ»."; stopCamera();}},20000);
 scan();
 }catch(e3){
 msg.innerHTML="Не удалось запустить видео. Обновите страницу и попробуйте снова.";
 console.log(e3);
 }
 finally{ starting=false; }
}
startBtn.addEventListener("click", startCamera);

function callApi(params, cb, onError){
 const cbName='cb_'+Math.random().toString(36).slice(2);
 let done=false;
 window[cbName]=function(){};
 const timeout=setTimeout(()=>{ if(!done){ done=true; if(onError) onError("⚠️ Нет ответа от сервера");}},12000);
 window[cbName]=function(res){
 if(done) return;
 done=true; clearTimeout(timeout); cb(res);
 setTimeout(()=>{ delete window[cbName]; },30000);
 };
 const query=new URLSearchParams(params);
 query.set('api','1'); query.set('callback', cbName); query.set('_ts', Date.now().toString());
 const script=document.createElement('script');
 script.src=API_URL+'?'+query.toString();
 script.onerror=()=>{ if(done) return; done=true; clearTimeout(timeout); if(onError) onError("⚠️ Ошибка связи с сервером"); };
 document.body.appendChild(script);
}

function flashStage(btn){
 btn.classList.add('stage-active');
 setTimeout(()=>btn.classList.remove('stage-active'),700);
}

function sendStage(stage, color, btn, photoUrl){
 let raw=orderInput.value.trim();
 let name=workerInput.value.trim();
 if(!raw){ statusEl.innerHTML="Введите/сканируйте номер"; return; }
 if(!name){ statusEl.innerHTML="Введите имя"; return; }
 if(btn) flashStage(btn);
 statusEl.innerHTML="Отправка...";
 callApi({action:'mark',stage,order:raw,name, color:color||'', db:'', photo_url:photoUrl||''},
 res=>{ statusEl.innerHTML = res.ok ? "✅ Готово" : "⚠️ " + res.msg; },
 err=>{ statusEl.innerHTML = err; }
 );
}

const hasBarcodeDetector = ('BarcodeDetector' in window);
const detector = hasBarcodeDetector ? new BarcodeDetector({formats:['qr_code']}) : null;

function scan(){
 if(locked) return;
 if(!isStreamActive()){ startCamera(); return; }

 if(hasBarcodeDetector){
 detector.detect(video).then(codes=>{
 if(codes && codes.length){
 const data = codes[0].rawValue || '';
 orderInput.value = data;
 msg.innerHTML = "QR найден: " + data;
 if(navigator.vibrate) navigator.vibrate(80);
 freezeCamera();
 return;
 }
 requestAnimationFrame(scan);
 }).catch(()=>requestAnimationFrame(scan));
 return;
 }

 if(video.readyState===video.HAVE_ENOUGH_DATA){
 canvas.width=video.videoWidth; canvas.height=video.videoHeight;
 ctx.drawImage(video,0,0,canvas.width,canvas.height);
 const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
 const code=jsQR(imageData.data,imageData.width,imageData.height,{inversionAttempts:"attemptBoth"});
 if(code){
 orderInput.value=code.data;
 msg.innerHTML="QR найден: " + code.data;
 if(navigator.vibrate) navigator.vibrate(80);
 freezeCamera(); return;
 }
 }
 requestAnimationFrame(scan);
}

const params = new URLSearchParams(location.search);
const only = (params.get('only') || '').toLowerCase();
const view = (params.get('view') || '').toLowerCase();

document.querySelectorAll('#stageButtons button').forEach(btn=>{
 const stage = btn.dataset.stage;
 const key = (btn.dataset.only || stage).toLowerCase();
 const color = btn.dataset.color || '';
 btn.onclick = () => {
 if(photoStages.has(stage)){
 openPhotoDialog(stage, color, btn);
 }else{
 sendStage(stage, color, btn, '');
 }
 };
 if (only && key !== only) btn.style.display = 'none';
});
if (only) stageTitle.textContent = "Этап:";

function openPhotoDialog(stage, color, btn){
 const overlay = document.createElement('div');
 overlay.id = 'photoOverlay';
 overlay.innerHTML = `
 <div class="photo-modal">
 <div class="photo-title">Загрузите фото для этапа</div>
 <input id="photoInput" type="file" accept="image/*" multiple />
 <div class="photo-actions">
 <button id="photoUpload">Загрузить</button>
 <button id="photoSkip">Продолжить без фото</button>
 <button id="photoCancel">Отмена</button>
 </div>
 <div id="photoMsg" class="small"></div>
 </div>`;
 document.body.appendChild(overlay);

 const input = document.getElementById('photoInput');
 const msgEl = document.getElementById('photoMsg');

 document.getElementById('photoCancel').onclick = ()=> overlay.remove();
 document.getElementById('photoSkip').onclick = ()=>{
 overlay.remove();
 sendStage(stage, color, btn, '');
 };

 document.getElementById('photoUpload').onclick = async ()=>{
 const files = Array.from(input.files || []);
 if(!files.length){ msgEl.textContent='Выберите фото'; return; }

 msgEl.textContent='Загрузка...';
 const folderUrl = await uploadPhotos(files, stage).catch(err=>{ msgEl.textContent=err; return null; });
 if(folderUrl){
 overlay.remove();
 sendStage(stage, color, btn, folderUrl);
 }
 };
}

async function uploadPhotos(files, stage){
 const order = orderInput.value.trim();
 const name = workerInput.value.trim();
 if(!order || !name) throw 'Введите заказ и имя';

 const now = new Date();
 const date = now.toLocaleDateString('ru-RU');
 const time = now.toTimeString().slice(0,5);

 const payload = {action:'upload_photos',order,stage,name,date,time,files:[]};

 for(const f of files){
 const data = await fileToBase64(f);
 payload.files.push({name:f.name, type:f.type, data});
 }

 const res = await fetch(API_URL, {
 method:'POST',
 headers:{'Content-Type':'application/json'},
 body: JSON.stringify(payload)
 }).then(r=>r.json());

 if(!res.ok) throw (res.msg || 'Ошибка загрузки');
 return res.folderUrl;
}

function fileToBase64(file){
 return new Promise((resolve,reject)=>{
 const r = new FileReader();
 r.onload = ()=> resolve(r.result.split(',')[1]);
 r.onerror = ()=> reject('Ошибка чтения файла');
 r.readAsDataURL(file);
 });
}

function openReports(){
 mainView.classList.add('hidden');
 reportsView.classList.remove('hidden');
 currentFilter='day';
 loadReports(currentFilter);
 if(reportsTimer) clearInterval(reportsTimer);
 reportsTimer = setInterval(()=>{ loadReports(currentFilter); },2000);
}
function closeReports(){
 reportsView.classList.add('hidden');
 mainView.classList.remove('hidden');
 if(reportsTimer){ clearInterval(reportsTimer); reportsTimer=null; }
}
if (view==='reports'){ setTimeout(openReports,0); }

function loadReports(filter, force){
 if(!force && reportsLoading) return;
 reportsLoading=true; currentFilter=filter;
 callApi({action:'reports', filter}, res=>{
 reportsLoading=false;
 if(!res.ok){ reportsStatus.textContent='⚠️ '+res.msg; return; }
 rawReports=res.data||[];
 applyFilterSort();
 }, ()=>{ reportsLoading=false; });
}

function applyFilterSort(){
 currentReports = rawReports.slice().filter(r=>{
 const id = reportId(r);
 return !deletedTombstones.has(id);
 });
 const t=(filterTerm||'').toLowerCase().trim();
 if(t){
 const words=t.split(/\s+/).filter(Boolean);
 currentReports=currentReports.filter(r=>{
 const line=(r.order+' '+r.date+' '+r.time+' '+r.stage+' '+r.name+' '+r.db).toLowerCase();
 for(let i=0;i<words.length;i++){ if(line.indexOf(words[i])!==-1) return true; }
 return false;
 });
 }
 currentReports.sort((a,b)=>compareReports(a,b,sortMode));
 reportsStatus.textContent='Найдено: '+currentReports.length+(t?(' | Поиск: '+t):'');
 renderReports();
}

function parseDateTime(r){
 const datePart=(r.date||'').split(' ')[0];
 const parts=datePart.split('.');
 if(parts.length<3) return0;
 const dd=parseInt(parts[0],10)||0;
 const mm=parseInt(parts[1],10)||0;
 const yy=parseInt(parts[2],10)||0;
 const year=2000+yy;
 const timeParts=(r.time||'00:00').split(':');
 const hh=parseInt(timeParts[0],10)||0;
 const mi=parseInt(timeParts[1],10)||0;
 return new Date(year,mm-1,dd,hh,mi,0).getTime();
}

function compareReports(a,b,mode){
 const av = (mode.indexOf('order')===0) ? (a.order||'') :
 (mode.indexOf('db')===0) ? (a.db||'') :
 (mode.indexOf('date')===0) ? parseDateTime(a) :
 (mode.indexOf('time')===0) ? parseDateTime(a) : '';
 const bv = (mode.indexOf('order')===0) ? (b.order||'') :
 (mode.indexOf('db')===0) ? (b.db||'') :
 (mode.indexOf('date')===0) ? parseDateTime(b) :
 (mode.indexOf('time')===0) ? parseDateTime(b) : '';
 const asc = mode.indexOf('_asc') !== -1;
 if(typeof av==='number') return asc ? (av-bv):(bv-av);
 const s1=String(av).toLowerCase(), s2=String(bv).toLowerCase();
 if(s1<s2) return asc ? -1 :1;
 if(s1>s2) return asc ?1 : -1;
 return0;
}

function renderReports(){
 reportsTableBody.innerHTML='';
 currentReports.forEach(r=>{
 const tr=document.createElement('tr');
 const orderTd=document.createElement('td');
 const dateTd=document.createElement('td');
 const timeTd=document.createElement('td');
 const stageTd=document.createElement('td');
 const nameTd=document.createElement('td');
 const dbTd=document.createElement('td');
 const actionTd=document.createElement('td');
 orderTd.textContent=r.order; dateTd.textContent=r.date; timeTd.textContent=r.time;
 stageTd.textContent=r.stage; nameTd.textContent=r.name; dbTd.textContent=r.db||'';

 if(r.photo_url){
 const link=document.createElement('a');
 link.href=r.photo_url; link.target='_blank';
 link.textContent='Фото';
 actionTd.appendChild(link);
 }

 if(editMode){
 const btn=document.createElement('button');
 btn.textContent='Удалить'; btn.dataset.db=r.db; btn.dataset.row=r.row;
 actionTd.classList.add('row-actions'); actionTd.appendChild(btn);
 }
 tr.append(orderTd,dateTd,timeTd,stageTd,nameTd,dbTd,actionTd);
 reportsTableBody.appendChild(tr);
 });

 if(editMode){
 reportsTableBody.querySelectorAll('button').forEach(btn=>{
 btn.onclick=()=>{
 if(!confirm('Удалить строку?')) return;
 const db=btn.dataset.db, row=btn.dataset.row;
 callApi({action:'delete_report',db,row}, res=>{
 if(!res.ok){ reportsStatus.textContent='⚠️ '+res.msg; return; }
 const id = String(db)+':'+String(row);
 deletedTombstones.set(id, Date.now());
 applyFilterSort();
 reportsStatus.textContent='✅ Удалено';
 setTimeout(()=>{ loadReports(currentFilter,true); },2000);
 }, ()=>{});
 };
 });
 }
}

function ymdToShort(ymd){
 if(!ymd) return '';
 const p=ymd.split('-'); if(p.length!==3) return '';
 const yy=p[0].slice(-2); return p[2]+'.'+p[1]+'.'+yy;
}
function countUniqueOrders(data, datePrefix, stage){
 const set=new Set();
 data.forEach(r=>{
 const okDate=datePrefix ? String(r.date||'').startsWith(datePrefix) : true;
 const okStage=(stage==='all') ? true : (String(r.stage||'').toLowerCase()===stage);
 if(okDate && okStage) set.add(String(r.order||'').trim());
 });
 return set.size;
}

document.querySelectorAll('.filters button').forEach(btn=>{ btn.onclick=()=>loadReports(btn.dataset.filter); });
searchInput.addEventListener('input',()=>{ filterTerm=searchInput.value.trim(); applyFilterSort(); });
sortSelect.onchange=()=>{ sortMode=sortSelect.value; applyFilterSort(); };

statsBtn.onclick=()=>{
 const d=statsDate.value, stage=statsStage.value, prefix=ymdToShort(d);
 if(!prefix){ statsResult.textContent='Выберите дату'; return; }
 statsResult.textContent='Считаю...';
 callApi({action:'reports',filter:'all'}, res=>{
 if(!res.ok){ statsResult.textContent='Ошибка'; return; }
 const cnt=countUniqueOrders(res.data||[], prefix, stage);
 statsResult.textContent='Уникальных заказов: '+cnt;
 }, ()=>{ statsResult.textContent='Нет ответа'; });
};

function parseYmdToMs(ymd){
 if(!ymd) return '';
 const p=ymd.split('-'); if(p.length!==3) return '';
 const y=parseInt(p[0],10), m=parseInt(p[1],10), d=parseInt(p[2],10);
 return new Date(y,m-1,d,0,0,0).getTime();
}

function escapeHtml(str){
 return String(str)
 .replace(/&/g,'&amp;')
 .replace(/</g,'&lt;')
 .replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;')
 .replace(/'/g,'&#39;');
}

async function loadImageAsDataURL(url){
 const res = await fetch(url, {mode:'cors'});
 const blob = await res.blob();
 return await new Promise(resolve=>{
 const reader = new FileReader();
 reader.onload = () => resolve(reader.result);
 reader.readAsDataURL(blob);
 });
}

function buildSummary(data){
 const map = new Map();

 data.forEach(r=>{
 const stage = String(r.stage||'').trim();
 const date = String(r.date||'').trim();
 const name = String(r.name||'').trim();
 if(!stage || !date || !name) return;

 const key = stage+'|'+date+'|'+name;
 if(!map.has(key)){
 map.set(key, {stage, date, name, orders: new Set()});
 }
 const order = String(r.order||'').trim();
 if(order) map.get(key).orders.add(order);
 });

 const rows = Array.from(map.values()).map(x=>({
 stage:x.stage,
 date:x.date,
 name:x.name,
 count:x.orders.size,
 orders:Array.from(x.orders).join(', ')
 }));

 rows.sort((a,b)=>{
 const d = a.date.localeCompare(b.date,'ru');
 if(d!==0) return d;
 const s = a.stage.localeCompare(b.stage,'ru');
 if(s!==0) return s;
 return a.name.localeCompare(b.name,'ru');
 });

 return rows;
}

exportPdfBtn.onclick=async ()=>{
 const fromMs = parseYmdToMs(pdfFrom.value);
 const toMs = parseYmdToMs(pdfTo.value);
 const toEnd = (toMs!==null) ? (toMs +24*60*60*1000 -1) : null;

 let data = rawReports.slice();
 if(fromMs) data = data.filter(r=>parseDateTime(r)>=fromMs);
 if(toEnd) data = data.filter(r=>parseDateTime(r)<=toEnd);

 if(!data.length){ alert("Нет данных для выбранного периода"); return; }

 const summaryRows = buildSummary(data);

 const period = (pdfFrom.value||'') + (pdfTo.value?(' — '+pdfTo.value):'');
 const logoUrl = "https://s.fstl.ai/workers/nano/image_1770296525645_6vc4s2.png";
 const logoData = await loadImageAsDataURL(logoUrl).catch(()=>'');

 const rowsHtml = data.map(r=>`
 <tr>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(r.order||'')}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(r.date||'')}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(r.time||'')}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(r.stage||'')}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(r.name||'')}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(r.db||'')}</td>
 </tr>
 `).join('');

 printArea.innerHTML = `
<div style="width:794px; padding:28px30px; font-family:Arial, 'Segoe UI', sans-serif; box-sizing:border-box;">
 <div style="display:flex; align-items:center; gap:14px;">
 ${logoData ? `<img src="${logoData}" style="width:320px;height:auto;object-fit:contain;">` : ''}
 <div>
 <div style="font-size:20px;font-weight:700;">Отчёт ${period ? '('+period+')' : ''}</div>
 <div style="font-size:12px;color:#555;">Сформировано: ${new Date().toLocaleString()}</div>
 </div>
 </div>

 <div style="margin-top:12px;font-size:12px;font-weight:700;">Сводка по сотрудникам:</div>
 <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:11px;">
 <thead>
 <tr>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Этап</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Дата</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Сотрудник</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Кол-во заказов</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Номера заказов</th>
 </tr>
 </thead>
 <tbody>
 ${summaryRows.map(s=>`
 <tr>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(s.stage)}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(s.date)}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(s.name)}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(String(s.count))}</td>
 <td style="border:1px solid #bbb;padding:6px5px;">${escapeHtml(s.orders)}</td>
 </tr>
 `).join('')}
 </tbody>
 </table>

 <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;">
 <thead>
 <tr>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Заказ</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Дата</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Время</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Этап</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Сотрудник</th>
 <th style="border:1px solid #bbb;padding:6px5px;background:#f2f2f2;">Таблица</th>
 </tr>
 </thead>
 <tbody>
 ${rowsHtml}
 </tbody>
 </table>
</div>
`;

 const fullCanvas = await html2canvas(printArea, {
 scale:2,
 useCORS:true,
 backgroundColor:'#ffffff'
 });

 const { jsPDF } = window.jspdf;
 const pdf = new jsPDF({unit:'mm', format:'a4', orientation:'portrait'});
 const pageWidth =210;
 const pageHeight =297;

 const pageHeightPx = Math.floor(fullCanvas.width * (pageHeight / pageWidth));
 let y =0;
 let pageIndex =0;

 while (y < fullCanvas.height){
 const pageCanvas = document.createElement('canvas');
 pageCanvas.width = fullCanvas.width;
 pageCanvas.height = Math.min(pageHeightPx, fullCanvas.height - y);
 const pageCtx = pageCanvas.getContext('2d', { willReadFrequently: true });

 pageCtx.fillStyle = '#ffffff';
 pageCtx.fillRect(0,0,pageCanvas.width,pageCanvas.height);
 pageCtx.drawImage(
 fullCanvas,
0, y, pageCanvas.width, pageCanvas.height,
0,0, pageCanvas.width, pageCanvas.height );

 const imgData = pageCanvas.toDataURL('image/png');
 const imgHeightMm = (pageCanvas.height / pageCanvas.width) * pageWidth;

 if (pageIndex >0) pdf.addPage();
 pdf.addImage(imgData, 'PNG',0,0, pageWidth, imgHeightMm);

 y += pageHeightPx;
 pageIndex++;
 }

 pdf.save('reports.pdf');
};

openReportsBtn.onclick=openReports;
closeReportsBtn.onclick=closeReports;

if(openPhotoStoreBtn){
 openPhotoStoreBtn.onclick=()=>window.open(PHOTO_ROOT_URL,'_blank');
}

editReportsBtn.onclick=()=>{
 const p=prompt('Пароль:');
 if(p===EDIT_PASS){ editMode=!editMode; editReportsBtn.textContent=editMode?'Выход':'Редактировать'; renderReports(); }
 else alert('Неверный пароль');
};

document.getElementById('refreshBtn').onclick = () => location.reload(true);
