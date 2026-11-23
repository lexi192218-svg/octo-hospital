import {supabaseUrl, publishableKey} from "./config.js";

const root = document.querySelector("#app");
const demoRoles = {
  admin:"Administrator", cashier:"Cashier", nurse:"Nurse", doctor:"Doctor",
  surgeon:"Surgeon", lab:"Laboratory", pharmacy:"Pharmacy",
};
const adminDesk = ["admin","cashier"];
const clinicians = ["doctor","surgeon"];
const payments = [["amount","Amount (₦)","money"],["method","Payment method",["Cash","Transfer","POS"]],["reference","Receipt reference"]];
const steps = {
  registration_payment:{label:"Confirm card payment", title:"Card payment", roles:adminDesk, fields:payments},
  vitals:{label:"Take vitals", title:"Vital signs", roles:["nurse"], fields:[["weight","Weight (kg)","decimal"],["height","Height (cm)","decimal"],["temperature","Temperature (°C)","decimal"],["pulse","Pulse (bpm)","number"],["bp","Blood pressure (mmHg)", "bp"]]},
  consultation:{label:"Record consultation", title:"Consultation", roles:["doctor"], fields:[["complaint","Patient complaint","area"],["assessment","Clinical assessment","area"],["plan","Care plan","area"]]},
  lab_order:{label:"Request lab test",title:"Lab order",roles:clinicians,fields:[["test","Test name"],["notes","Lab instructions","optional"]]},
  lab_result:{label:"Enter lab result",title:"Lab result",roles:["lab"],parent:"lab_order",fields:[["result","Result and units","area"]]},
  prescription:{label:"Write prescription",title:"Prescription",roles:clinicians,fields:[["medicine","Medication"],["instructions","Dose, route, frequency and duration","area"]]},
  pharmacy_quote:{label:"Price prescription",title:"Pharmacy quote",roles:["pharmacy"],parent:"prescription",fields:[["amount","Amount (₦)","money"]]},
  pharmacy_payment:{label:"Confirm pharmacy payment",title:"Pharmacy payment",roles:adminDesk,parent:"prescription",fields:payments},
  dispense:{label:"Confirm dispensing",title:"Medication dispensed",roles:["pharmacy"],parent:"prescription",fields:[["notes","Quantity dispensed and notes","area"]]},
  surgery_referral:{label:"Refer to surgery",title:"Surgery referral",roles:["doctor"],fields:[["procedure","Planned procedure"],["notes","Referral notes","area"]]},
  surgery_note:{label:"Record surgery outcome",title:"Surgery outcome",roles:["surgeon"],parent:"surgery_referral",fields:[["outcome","Procedure, outcome and aftercare","area"]]},
  maternity:{label:"Add maternity note",title:"Maternity note",roles:["doctor","nurse"],fields:[["notes","Antenatal or maternity notes","area"]]},
  discharge:{label:"Close visit",title:"Visit closed",roles:clinicians,fields:[["notes","Follow-up instructions","area"]]},
};
const finishedBy = {lab_order:"lab_result",prescription:"dispense",surgery_referral:"surgery_note"};
const department = {admin:"Front desk & staff administration",cashier:"Front desk & payments",nurse:"Nursing & vital signs",doctor:"Consultation room",surgeon:"Surgery",lab:"Laboratory",pharmacy:"Pharmacy"};
const brand = '<a class="brand" href="/" aria-label="OCTO Hospital home"><span class="mark" aria-hidden="true">✚</span><span>OCTO<small>HOSPITAL</small></span></a>';
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const label = value => value.replaceAll("_"," ").replace(/^./,c => c.toUpperCase());
const date = iso => new Intl.DateTimeFormat("en-NG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Lagos"}).format(new Date(iso));
const money = n => new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN"}).format(n);
const card = n => "OCT-" + String(n).padStart(5,"0");
const state = {token:null,refresh:null,expires:0,staff:null,demo:false,role:"admin",page:"queue",patients:[],latest:[],person:null,visits:[],events:[],status:{},refs:[],picked:null,search:"",activity:null,notice:"",staffList:[]};
let demo;
let myProfile = null;
let myFiles = [];
let requestGeneration = 0;

let refreshing;
async function api(path, {method="GET", data, token=state.token, prefer}={}) {
  if (token && token===state.token && state.refresh && Date.now() > state.expires-60000) {
    refreshing ||= api("/auth/v1/token?grant_type=refresh_token",{
      method:"POST",data:{refresh_token:state.refresh},token:null,
    }).then(session).finally(()=>{refreshing=null;});
    await refreshing;
    token=state.token;
  }
  const response = await fetch(supabaseUrl + path, {
    method, cache:"no-store", headers:{
      apikey:publishableKey, "Content-Type":data instanceof Blob ? data.type : "application/json",
      ...(token ? {Authorization:"Bearer "+token} : {}),
      ...(prefer ? {Prefer:prefer} : {}),
    },body:data === undefined ? undefined : (data instanceof Blob ? data : JSON.stringify(data)),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.message || result?.msg || result?.error_description || result?.error || "Request failed. Try again.");
  return result;
}
function session(result) {
  state.token = result.access_token;
  state.refresh = result.refresh_token;
  state.expires = Date.now() + result.expires_in*1000;
}
async function database(path, options) {
  return api("/rest/v1/" + path,options);
}
function notice(message, success) {
  const node = document.querySelector("#message");
  if (node) {
    node.textContent = message;
    node.classList.toggle("status",success);
  }
}
function field([name, caption, type="text"]) {
  const options = Array.isArray(type);
  const attributes = {decimal:'type="number" step="0.1" min="0.1"',number:'type="number" step="1" min="1"',money:'type="number" step="0.01" min="0.01" max="999999999.99"',bp:'type="text" pattern="[0-9]{2,3}/[0-9]{1,3}" placeholder="120/80"',optional:'type="text"',text:'type="text"',date:'type="date"',tel:'type="tel"'};
  const control = options
    ? '<select name="'+name+'" required><option value="">Choose an option</option>'+type.map(v=>'<option>'+escape(v)+'</option>').join("")+'</select>'
    : type === "area" ? '<textarea name="'+name+'" rows="3" maxlength="1200" required></textarea>'
    : '<input name="'+name+'" '+attributes[type]+(type==="optional" ? "" : " required")+(["text","optional","tel"].includes(type) ? ' maxlength="'+(type==="tel"?25:120)+'"' : "")+'>';
  return '<label class="'+(type==="area"?"wide":"")+'">'+caption+control+'</label>';
}
function signIn(setPassword=false) {
  root.innerHTML = '<main class="signin"><section class="signin-image"><h2>One visit.<br>One shared record.</h2></section><section class="signin-content"><div>'+brand+
    '<h1>'+(setPassword?"Set your password":"Staff sign in")+'</h1><p class="muted">'+(setPassword?"Choose a password for your invited staff account.":"Use the staff account created by your hospital administrator.")+'</p>'+
    '<form id="'+(setPassword?"password":"login")+'" class="stack">'+(setPassword?"":'<label>Work email<input type="email" name="email" autocomplete="username" required></label>')+
    '<label>Password<input name="password" type="password" autocomplete="'+(setPassword?"new-password":"current-password")+'" '+(setPassword?'minlength="12" ':"")+'required></label>'+
    '<button class="button">'+(setPassword?"Save password":"Sign in")+'</button></form><p id="message" class="message" role="status"></p>'+
    (setPassword?"":'<hr><button class="button line" data-action="demo">Open practice workspace</button><p class="muted">Uses fictional records. Changes last until you leave or refresh.</p>')+'</div></section></main>';
}
function seedDemo() {
  const first = {id:crypto.randomUUID(),card:1001,name:"Adaeze Nwosu",dob:"1991-03-12",phone:""};
  const second = {id:crypto.randomUUID(),card:1002,name:"Ibrahim Bello",dob:"1985-06-27",phone:""};
  const visit = {id:crypto.randomUUID(),patient_id:first.id,opened_at:new Date().toISOString(),urgent:false};
  const previous = {id:crypto.randomUUID(),patient_id:second.id,opened_at:new Date().toISOString(),urgent:true};
  return {patients:[first,second],visits:[visit,previous],events:[
    {id:crypto.randomUUID(),visit_id:visit.id,kind:"registration_payment",details:{amount:"3500",method:"POS",reference:"SAMPLE-001"},recorded_at:visit.opened_at},
  ],staff:[]};
}
function visibleEvent(event) {
  if (["nurse","doctor","surgeon"].includes(state.role)) return true;
  const lists = {admin:["registration_payment","pharmacy_quote","pharmacy_payment"],cashier:["registration_payment","pharmacy_quote","pharmacy_payment"],lab:["lab_order","lab_result"],pharmacy:["prescription","pharmacy_quote","pharmacy_payment","dispense"]};
  return lists[state.role].includes(event.kind);
}
async function reload() {
  const generation = ++requestGeneration;
  let patients, latest;
  if (state.demo) {
    patients = [...demo.patients].reverse();
    latest = [...demo.visits].reverse().map(v=>({...v,stage:demoStatus(v.id)}));
  } else {
    const search = state.search.trim();
    const filters = new URLSearchParams({select:"id,card,name,dob,phone",order:"created_at.desc",limit:"100"});
    if (search) {
      const n = search.match(/^(?:OCT-)?(\d{1,12})$/i)?.[1];
      if (n) filters.set("card","eq."+Number(n));
      else filters.set("name","ilike.*"+search.replace(/[*%_\\]/g,"")+"*");
    }
    [patients,latest] = await Promise.all([
      database("patients?"+filters),
      database("rpc/recent_queue",{method:"POST",data:{}}),
    ]);
  }
  if (generation !== requestGeneration) return;
  state.patients = patients;
  state.latest = latest;
  if (!state.person && patients.length) state.person = patients[0].id;
  if (state.person) await loadPatient(state.person,state.picked);
}
function demoStatus(id) {
  const events = demo.events.filter(e=>e.visit_id===id);
  const has = kind => events.some(e=>e.kind===kind);
  const visit = demo.visits.find(v=>v.id===id);
  const paid = demo.events.some(e=>e.kind==="registration_payment" && demo.visits.some(v=>v.id===e.visit_id && v.patient_id===visit.patient_id && v.opened_at<=visit.opened_at));
  return {paid,vitals:has("vitals"),consultation:has("consultation"),closed:has("discharge"),
    lab:events.some(e=>e.kind==="lab_order"&&!events.some(x=>x.parent_id===e.id&&x.kind==="lab_result")),
    pharmacy:events.some(e=>e.kind==="prescription"&&!events.some(x=>x.parent_id===e.id&&x.kind==="dispense")),
    pharmacy_payment:events.some(e=>e.kind==="pharmacy_quote"&&!events.some(x=>x.parent_id===e.parent_id&&x.kind==="pharmacy_payment")),
    surgery:events.some(e=>e.kind==="surgery_referral"&&!events.some(x=>x.parent_id===e.id&&x.kind==="surgery_note")),
  };
}
async function loadPatient(id,picked=null) {
  state.person = id;
  if (state.demo) {
    state.visits = [...demo.visits].reverse().filter(v=>v.patient_id===id);
    state.events = demo.events.filter(e=>state.visits.some(v=>v.id===e.visit_id)&&visibleEvent(e)).reverse();
    state.status = Object.fromEntries(state.visits.map(v=>[v.id,demoStatus(v.id)]));
  } else {
    state.visits = await database("visits?select=id,patient_id,urgent,opened_at&order=opened_at.desc&limit=50&patient_id=eq."+encodeURIComponent(id));
    const ids = state.visits.map(v=>v.id).join(",");
    const [events,stages] = ids ? await Promise.all([
      database("events?select=id,visit_id,kind,parent_id,details,actor,recorded_at&order=recorded_at.desc&limit=1000&visit_id=in.("+ids+")"),
      database("rpc/visit_stages",{method:"POST",data:{patient:id}}),
    ]) : [[],[]];
    state.events = events;
    state.status = Object.fromEntries(stages.map(v=>[v.id,v.stage]));
  }
  state.picked = state.visits.some(v=>v.id===picked) ? picked : (state.visits[0]?.id ?? null);
  await loadRefs();
}
async function loadRefs() {
  state.refs = [];
  if (!adminDesk.includes(state.role) || !state.picked) return;
  state.refs = state.demo
    ? demo.events.filter(e=>e.visit_id===state.picked&&e.kind==="prescription"&&!demo.events.some(x=>x.parent_id===e.id&&x.kind==="pharmacy_payment"))
    : await database("rpc/open_prescription_refs",{method:"POST",data:{visit:state.picked}});
}
function stageText(visit, stage={}) {
  if (stage.closed) return "Visit closed";
  if (stage.lab || stage.pharmacy || stage.surgery) return "Orders in progress";
  if (stage.consultation) return "Consultation recorded";
  if (stage.vitals || visit.urgent) return "Ready for clinician";
  if (stage.paid) return "Ready for vitals";
  return "Awaiting card payment";
}
function roleQueue(visit, stage) {
  if (stage.closed) return false;
  const ready = {admin:!stage.paid||stage.pharmacy_payment,cashier:!stage.paid||stage.pharmacy_payment,nurse:!stage.vitals&&(stage.paid||visit.urgent),doctor:(stage.vitals||visit.urgent),lab:stage.lab,pharmacy:stage.pharmacy,surgeon:stage.surgery};
  return ready[state.role];
}
function selected() {
  return state.visits.find(v=>v.id===state.picked);
}
function visitEvents(id) {
  return state.events.filter(e=>e.visit_id===id);
}
function available(visit) {
  const status = state.status[visit.id] || {};
  const events = visitEvents(visit.id);
  if (status.closed) return [];
  return Object.entries(steps).filter(([kind,step])=>{
    if (!step.roles.includes(state.role)) return false;
    const eligible = {
      registration_payment:!status.paid,
      vitals:!status.vitals&&(status.paid||visit.urgent),
      consultation:status.vitals||visit.urgent,
      lab_order:status.consultation,
      prescription:status.consultation,
      surgery_referral:status.consultation,
      discharge:status.consultation&&!status.lab&&!status.pharmacy&&!status.surgery,
    };
    if (step.parent) return linkedOrders(kind,events).length > 0;
    return eligible[kind] ?? true;
  });
}
function linkedOrders(kind,events) {
  if (kind==="pharmacy_payment") return state.refs.map(e=>({...e,quote:events.find(q=>q.kind==="pharmacy_quote"&&q.parent_id===e.id)})).filter(e=>e.quote);
  return events.filter(e=>e.kind===steps[kind].parent
    && !events.some(x=>x.parent_id===e.id&&x.kind===kind)
    && (kind!=="dispense" || events.some(x=>x.parent_id===e.id&&x.kind==="pharmacy_payment")));
}
function workflowForm(visit) {
  const kind = state.activity;
  if (kind==="new-patient") return '<form id="new-patient" class="gridform"><h3 class="wide">Register patient</h3>'+[["name","Full name"],["dob","Date of birth","date"],["phone","Phone","tel"]].map(field).join("")+'<div class="actions wide"><button class="button">Save patient</button><button type="button" class="button line" data-action="cancel">Cancel</button></div></form>';
  if (kind==="new-visit") return '<form id="new-visit" class="stack"><h3>Open a visit</h3><label class="check"><input type="checkbox" name="urgent">Urgent visit · care can start before payment</label><div class="actions"><button class="button">Open visit</button><button type="button" class="button line" data-action="cancel">Cancel</button></div></form>';
  if (!visit || !steps[kind]) return "";
  const step = steps[kind];
  const linked = step.parent ? '<label class="wide">Linked order<select name="parent" required><option value="">Select an order</option>'+linkedOrders(kind,visitEvents(visit.id)).map(e=>'<option value="'+e.id+'">'+escape(e.details?.test||e.details?.medicine||e.details?.procedure||"Order")+" · "+e.id.slice(0,8)+(e.quote?" · "+money(e.quote.details.amount):"")+'</option>').join("")+'</select></label>' : "";
  return '<form id="event" class="gridform"><h3 class="wide">'+step.label+'</h3>'+linked+step.fields.map(field).join("")+'<div class="actions wide"><button class="button">Save entry</button><button type="button" class="button line" data-action="cancel">Cancel</button></div></form>';
}
function history(event) {
  const fields = Object.entries(event.details).map(([key,value])=>'<dt>'+escape(key==="bmi"?"BMI":label(key))+'</dt><dd>'+escape(key==="amount"?money(value):value)+'</dd>').join("");
  return '<li><b>'+steps[event.kind].title+'</b> <time>'+date(event.recorded_at)+'</time>'+(event.actor?' <span class="order-id" title="Staff identifier">· '+escape(event.actor.slice(0,8))+'</span>':'')+(event.parent_id?'<small class="order-id"> · Order '+event.parent_id.slice(0,8)+'</small>':'')+'<dl>'+fields+'</dl></li>';
}
function render() {
  const desk = adminDesk.includes(state.role);
  const person = state.patients.find(p=>p.id===state.person) ?? state.latest.find(q=>q.patient_id===state.person)?.patient;
  const visit = person && selected();
  const waiting = state.latest.filter(v=>roleQueue(v,v.stage));
  const urgent = waiting.filter(v=>v.urgent).length;
  const query = state.search.toLowerCase();
  const people = state.demo && query ? state.patients.filter(p=>[p.name,card(p.card),String(p.card)].some(v=>v.toLowerCase().includes(query))) : state.patients;
  const title = state.page==="staff"?"Staff accounts":state.page==="profile"?"My staff profile":state.page==="patients"?"Patient directory":"Department queue";
  const menu = [["queue","Department queue"],["patients","Patient directory"],["profile","My profile"],...(state.role==="admin"?[["staff","Staff accounts"]]:[])];
  root.innerHTML = '<div class="shell"><aside class="sidebar">'+brand+'<div><strong>'+escape(state.staff?.name || "Practice workspace")+'</strong><br><small>'+demoRoles[state.role]+'</small></div>'+
    (state.demo?'<label>Practice as<select id="role">'+Object.entries(demoRoles).map(([k,v])=>'<option value="'+k+'" '+(k===state.role?"selected":"")+'>'+v+'</option>').join("")+'</select></label>':"")+
    '<nav aria-label="Workspace">'+menu.map(([k,v])=>'<button data-action="page" data-value="'+k+'" aria-current="'+(state.page===k?"page":"false")+'">'+v+'</button>').join("")+
    '<button data-action="logout">'+(state.demo?"Leave practice":"Sign out")+'</button></nav><footer><a href="/">Public hospital site ↗</a></footer></aside>'+
    '<main><header class="workhead"><div><p class="eyebrow">'+department[state.role].toUpperCase()+'</p><h1>'+title+'</h1></div><button class="button line" data-action="refresh">Refresh</button></header>'+
    (state.demo?'<p class="banner">Practice mode · Use fictional information only. This workspace does not send records to the hospital database.</p>':"")+
    '<p id="message" class="message" role="status"></p>'+
    (state.page==="staff" ? staffPage() : state.page==="profile" ? profilePage() :
      '<div class="stat-grid"><div class="panel"><strong>'+waiting.length+'</strong>In this queue</div><div class="panel"><strong>'+urgent+'</strong>Urgent in this queue</div><div class="panel"><strong>'+state.latest.length+'</strong>Recent visits</div></div>'+
      '<div class="workgrid"><section class="panel"><div class="panel-head"><h2>'+(state.page==="queue"?"Queue":"Find a patient")+'</h2>'+(desk?'<button class="button line" data-action="activity" data-value="new-patient">New patient</button>':"")+'</div>'+
      (state.page==="patients"?'<form id="search" class="stack"><label>Name or card number<input name="search" value="'+escape(state.search)+'" placeholder="e.g. OCT-01001"></label><button class="button line">Search</button></form>':"")+
      '<div class="record-list">'+(state.page==="queue" ? waiting.map(v=>record(v.patient || state.patients.find(p=>p.id===v.patient_id),v)).join("") : people.map(p=>record(p)).join(""))+
      ((state.page==="queue"?waiting.length:people.length)?"":'<p class="muted">No matching records.</p>')+'</div></section>'+
      '<section class="panel">'+(person?'<div class="visit-head"><div><h2>'+escape(person.name)+'</h2><p class="muted">'+card(person.card)+(person.dob?' · DOB '+escape(person.dob):"")+(person.phone?' · '+escape(person.phone):"")+'</p></div>'+(desk?'<div class="actions">'+(state.status[visit?.id]?.paid?'<button class="button line" data-action="print">Print card</button>':'')+'<button class="button line" data-action="activity" data-value="new-visit">Open visit</button></div>':"")+'</div>':"")+
      (visit?'<label>Visit<select id="visit">'+state.visits.map(v=>'<option value="'+v.id+'" '+(v.id===visit.id?"selected":"")+'>'+date(v.opened_at)+(v.urgent?" · Urgent":"")+'</option>').join("")+'</select></label><p><span class="tag '+(visit.urgent?"urgent":"")+'">'+stageText(visit,state.status[visit.id])+'</span></p><div class="actions">'+available(visit).map(([k,v])=>'<button class="button line" data-action="activity" data-value="'+k+'">'+v.label+'</button>').join("")+'</div>':"")+
      workflowForm(visit)+(person&&!state.activity ? '<h3>Patient history</h3>'+(state.events.length?'<ul class="history-list">'+state.events.map(history).join("")+'</ul>':'<p class="muted">No visible entries for this patient yet.</p>'):"")+
      (!person&&!state.activity?'<p class="muted">Select a patient to open their record.</p>':"")+'</section></div>')+'</main></div>';
}
function record(p,visit) {
  if (!p) return "";
  return '<button class="record" data-action="patient" data-value="'+p.id+'" data-visit="'+(visit?.id||"")+'" aria-pressed="'+(p.id===state.person&&(!visit||visit.id===state.picked))+'"><b>'+escape(p.name)+'</b><small>'+card(p.card)+(visit?' · '+stageText(visit,visit.stage)+(visit.urgent?' · Urgent':""):"")+'</small></button>';
}
function staffPage() {
  return '<section class="panel"><h2>Invite a staff member</h2><p class="muted">The staff member receives an invitation and chooses their own password.</p><form id="invite" class="gridform"><label>Full name<input name="name" required maxlength="120"></label><label>Work email<input type="email" name="email" required maxlength="254"></label><label>Staff role<select name="role" required><option value="">Choose a role</option>'+Object.entries(demoRoles).filter(([k])=>k!=="admin").map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join("")+'</select></label><div class="actions wide"><button class="button">'+(state.demo?"Add practice staff":"Send invitation")+'</button></div></form></section><br><section class="panel"><h2>Staff directory</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Access</th><th>Action</th></tr></thead><tbody>'+
    state.staffList.map(staff=>'<tr><td>'+escape(staff.name)+'<br><small>'+escape(staff.email)+'</small></td><td>'+demoRoles[staff.role]+'</td><td>'+(staff.active?"Active":"Suspended")+'</td><td>'+(staff.role==="admin"?"":'<button class="button line" data-action="access" data-value="'+staff.id+'" data-active="'+!staff.active+'">'+(staff.active?"Suspend":"Restore")+'</button>')+'</td></tr>').join("")+'</tbody></table></div></section>';
}
function profilePage() {
  return '<section class="panel"><h2>'+escape(state.staff?.name || "Practice profile")+'</h2><p>'+demoRoles[state.role]+'</p><form id="profile" class="stack"><label>Specialty or unit<input name="specialty" maxlength="120" value="'+escape(myProfile?.specialty)+'"></label><label>Professional bio<textarea name="bio" maxlength="1500" rows="4">'+escape(myProfile?.bio)+'</textarea></label><div><button class="button">Save profile</button></div></form></section>'+
    (state.demo?'':'<br><section class="panel"><h2>Private staff files</h2><p class="muted">Upload a staff photo or credential as a JPG, PNG, WebP or PDF file.</p><form id="upload" class="stack"><label>Choose file<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><div><button class="button">Upload file</button></div></form><div class="record-list">'+
    myFiles.map(file=>'<button class="record" data-action="file-open" data-value="'+escape(file.name)+'">'+escape(file.name.slice(37))+'</button>').join("")+'</div></section>');
}
async function loadProfile() {
  if (state.demo) { myProfile=demo.profile || {}; myFiles=[]; return; }
  const [rows, files] = await Promise.all([
    database("staff_profiles?select=bio,specialty&id=eq."+state.staff.id),
    api("/storage/v1/object/list/staff-private",{method:"POST",data:{prefix:state.staff.id,limit:100}}),
  ]);
  myProfile=rows[0] || null;
  myFiles=files.filter(file=>file.id);
}
async function loadStaff() {
  state.staffList = state.demo?demo.staff:await database("staff?select=id,name,email,role,active&order=name");
}
async function updateStaff(data) {
  if (!state.demo) return api("/functions/v1/staff",{method:"POST",data});
  if (data.action==="access") {
    const staff = demo.staff.find(s=>s.id===data.id);
    if (staff) staff.active = data.active;
  } else {
    if (demo.staff.some(s=>s.email.toLowerCase()===data.email.toLowerCase())) throw new Error("This email already has an account.");
    demo.staff.push({...data,id:crypto.randomUUID(),active:true});
  }
}
async function enterStaff() {
  const staff = await database("staff?select=id,name,role,active&active=eq.true");
  const user = await api("/auth/v1/user");
  state.staff = staff.find(row=>row.id===user.id);
  if (!state.staff) throw new Error("Your hospital administrator must activate your account.");
  state.role = state.staff.role;
  await reload();
  render();
}
function reset() {
  ++requestGeneration;
  Object.assign(state,{token:null,refresh:null,expires:0,staff:null,demo:false,role:"admin",page:"queue",patients:[],latest:[],person:null,visits:[],events:[],status:{},refs:[],picked:null,search:"",activity:null,staffList:[]});
  demo = undefined;
  myProfile = {}; myFiles = [];
  signIn();
}
let busy = false;
async function run(task, button) {
  if (busy) return;
  busy = true;
  notice("",true);
  if (button) button.disabled = true;
  try { await task(); }
  catch(error) { notice(error.message || "Something went wrong.",false); }
  finally { busy = false; if (button) button.disabled = false; }
}
root.addEventListener("click", event=>{
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const {action,value} = button.dataset;
  run(async()=>{
    switch(action) {
      case "demo": state.demo=true; demo=seedDemo(); await reload(); render(); break;
      case "logout": try { if (state.token) await api("/auth/v1/logout",{method:"POST"}); } finally { reset(); } break;
      case "refresh": if (state.page==="staff") await loadStaff(); else if (state.page==="profile") await loadProfile(); else await reload(); render(); break;
      case "page": state.activity=null; state.page=value; if (value==="staff") await loadStaff(); else if (value==="profile") await loadProfile(); else await reload(); render(); break;
      case "patient": state.activity=null; await loadPatient(value,button.dataset.visit); render(); break;
      case "activity": state.activity=value; render(); document.querySelector(".gridform input,.gridform select,.gridform textarea,#new-visit input")?.focus(); break;
      case "print": {
        const person = state.patients.find(p=>p.id===state.person) ?? state.latest.find(v=>v.patient_id===state.person)?.patient;
        if (!person) throw new Error("Select a patient first.");
        const printCard = document.createElement("section");
        printCard.className = "print-card";
        printCard.innerHTML = brand+'<h1>Patient card</h1><p><b>'+escape(person.name)+'</b></p><p>'+card(person.card)+'</p>';
        document.body.append(printCard);
        window.print();
        printCard.remove();
        break;
      }
      case "cancel": state.activity=null; render(); break;
      case "file-open": {
        const signed = await api("/storage/v1/object/sign/staff-private/"+state.staff.id+"/"+encodeURIComponent(value),{method:"POST",data:{expiresIn:60}});
        const path = signed.signedURL;
        if (!path?.startsWith("/object/sign/staff-private/")) throw new Error("Could not open this file.");
        const download = document.createElement("a");
        download.href = supabaseUrl+"/storage/v1"+path+"&download=";
        download.rel = "noreferrer"; download.target = "_blank"; download.click();
        break;
      }
      case "access": await updateStaff({action:"access",id:value,active:button.dataset.active==="true"}); await loadStaff(); render(); notice("Staff access updated.",true); break;
    }
  },button);
});
root.addEventListener("change",event=>{
  const {id,value} = event.target;
  if (id==="role") run(async()=>{state.role=value;state.page="queue";state.activity=null;await reload();render();});
  if (id==="visit") run(async()=>{state.picked=value;state.activity=null;await loadRefs();render();});
});
root.addEventListener("submit", event=>{
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries([...formData].filter(([,value])=>typeof value==="string"));
  for (const key of Object.keys(data)) if (key!=="password") data[key] = data[key].trim();
  run(async()=>{
    if (form.id==="login") {
      try { session(await api("/auth/v1/token?grant_type=password",{method:"POST",data,token:null})); await enterStaff(); }
      catch(error) { reset(); throw error; }
      return;
    }
    if (form.id==="password") {
      await api("/auth/v1/user",{method:"PUT",data});
      await enterStaff();
      return;
    }
    if (form.id==="profile") {
      if (state.demo) demo.profile = data;
      else if (myProfile) await database("staff_profiles?id=eq."+state.staff.id,{method:"PATCH",data});
      else await database("staff_profiles",{method:"POST",data:{id:state.staff.id,...data}});
      await loadProfile(); render(); notice("Profile saved.",true); return;
    }
    if (form.id==="upload") {
      const file=formData.get("file");
      const types=["image/jpeg","image/png","image/webp","application/pdf"];
      if (!file?.size || file.size>5242880 || !types.includes(file.type)) throw new Error("Choose a JPG, PNG, WebP or PDF file under 5 MB.");
      const name=crypto.randomUUID()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-80);
      await api("/storage/v1/object/staff-private/"+state.staff.id+"/"+encodeURIComponent(name),{method:"POST",data:file});
      await loadProfile(); render(); notice("Private file uploaded.",true); return;
    }
    if (form.id==="search") {state.search=data.search;state.person=null;state.picked=null;state.activity=null;await reload();render();return;}
    if (form.id==="invite") {await updateStaff(data);await loadStaff();render();notice(state.demo?"Practice staff added.":"Invitation sent.",true);return;}
    if (form.id==="new-patient") {
      if (data.name.length<2) throw new Error("Enter the patient’s full name.");
      if (data.dob>new Date().toISOString().slice(0,10)) throw new Error("Date of birth cannot be in the future.");
      const person = {name:data.name,dob:data.dob,phone:data.phone};
      if (state.demo) {person.id=crypto.randomUUID();person.card=1001+demo.patients.length;demo.patients.push(person);}
      else Object.assign(person,(await database("patients?select=id,card",{method:"POST",data:person,prefer:"return=representation"}))[0]);
      state.person=person.id;state.picked=null;state.search="";state.page="patients";
    }
    if (form.id==="new-visit") {
      const visit={patient_id:state.person,urgent:data.urgent==="on"};
      if (state.demo) {visit.id=crypto.randomUUID();visit.opened_at=new Date().toISOString();demo.visits.push(visit);}
      else Object.assign(visit,(await database("visits?select=id",{method:"POST",data:visit,prefer:"return=representation"}))[0]);
      state.picked=visit.id;
    }
    if (form.id==="event") {
      for (const [key,,type] of steps[state.activity].fields)
        if (type!=="optional"&&!data[key]) throw new Error("Complete the required fields.");
      const parent=data.parent||null;
      delete data.parent;
      const entry={visit_id:state.picked,kind:state.activity,parent_id:parent,details:data};
      if (state.demo) {
        if (entry.kind==="pharmacy_payment") {
          const quote=demo.events.find(e=>e.parent_id===parent&&e.kind==="pharmacy_quote");
          if (Number(quote?.details.amount)!==Number(data.amount)) throw new Error("The payment must match the pharmacy quote.");
        }
        if (data.reference) {
          data.reference=data.reference.toUpperCase();
          if (demo.events.some(e=>e.details.reference===data.reference)) throw new Error("This receipt is already recorded.");
        }
        if (entry.kind==="vitals") {
          if (+data.weight<.2||+data.weight>500||+data.height<15||+data.height>270||+data.temperature<20||+data.temperature>48||+data.pulse>350)
            throw new Error("Check the vitals and measurement units.");
          data.bmi=(Number(data.weight)/(Number(data.height)/100)**2).toFixed(1);
        }
        demo.events.push({...entry,id:crypto.randomUUID(),recorded_at:new Date().toISOString()});
      } else await database("events",{method:"POST",data:entry});
    }
    state.activity=null;
    await reload();
    render();
    notice("Saved successfully.",true);
  },event.submitter);
});
const invitation = new URLSearchParams(location.hash.slice(1));
if (invitation.get("type")==="invite" && invitation.has("access_token")) {
  session({access_token:invitation.get("access_token"),refresh_token:invitation.get("refresh_token"),expires_in:Number(invitation.get("expires_in")||3600)});
  window.history.replaceState(null,"",location.pathname);
  signIn(true);
} else signIn();
