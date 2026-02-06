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

const savedName = localStorage.getItem('workerName') || '';
if(savedName) workerInput.value = savedName;
workerInput.addEventListener('input', ()=>localStorage.setItem('workerName', workerInput.value.trim()));

function parseDbOrderClient(raw){
 const s = String(raw || '').trim();
 if (s.includes('|')){
 const parts = s.split('|');
 return { db: parts[0].trim(), order: parts.slice(1).join('|').trim() };
 }
 return { db:'', order:s };
}

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
 const parsed = parseDbOrderClient(orderInput.value);
 let raw = parsed.order;
 let db = parsed.db;
 let name=workerInput.value.trim();
 if(!raw){ statusEl.innerHTML="Введите/сканируйте номер"; return; }
 if(!name){ statusEl.innerHTML="Введите имя"; return; }
 if(btn) flashStage(btn);
 statusEl.innerHTML="Отправка...";
 callApi({action:'mark',stage,order:raw,name, color:color||'', db:db, photo_url:photoUrl||''},
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
 const parsed = parseDbOrderClient(orderInput.value);
 const order = parsed.order;
 const db = parsed.db;

 const name = workerInput.value.trim();
 if(!order || !name) throw 'Введите заказ и имя';

 const now = new Date();
 const date = now.toLocaleDateString('ru-RU');
 const time = now.toTimeString().slice(0,5);

 const payload = {action:'upload_photos',order,stage,name,date,time,db,files:[]};

 for(const f of files){
 const data = await fileToBase64(f);
 payload.files.push({name:f.name, type:f.type, data});
 }

 const res = await fetch(API_URL, {
 method: 'POST',
 headers: { 'Content-Type':'text/plain;charset=utf-8' },
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

document.querySelectorAll('.filters button').forEach(btn=>{ btn.onclick=()=>loadReports(btn.dataset.filter); });
searchInput.addEventListener('input',()=>{ filterTerm=searchInput.value.trim(); applyFilterSort(); });
sortSelect.onchange=()=>{ sortMode=sortSelect.value; applyFilterSort(); };

statsBtn.onclick=()=>{
 const d=statsDate.value, stage=statsStage.value;
 if(!d){ statsResult.textContent='Выберите дату'; return; }
 statsResult.textContent='Считаю...';
 callApi({action:'reports',filter:'all'}, res=>{
 if(!res.ok){ statsResult.textContent='Ошибка'; return; }
 const prefix = d.split('-'); if(prefix.length!==3){ statsResult.textContent='Ошибка даты'; return; }
 const datePrefix = prefix[2]+'.'+prefix[1]+'.'+prefix[0].slice(-2);
 const cnt = new Set((res.data||[]).filter(r=>String(r.date||'').startsWith(datePrefix) && (stage==='all'||String(r.stage||'').toLowerCase()===stage)).map(r=>String(r.order||'').trim())).size;
 statsResult.textContent='Уникальных заказов: '+cnt;
 }, ()=>{ statsResult.textContent='Нет ответа'; });
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
