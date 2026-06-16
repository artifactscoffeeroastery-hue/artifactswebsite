// ── STATE ──
let cart = JSON.parse(localStorage.getItem('coffee_cart')) || [];
const productQtys = { gt:1, mx:1, ni:1, dp:1 };
let currentUser = null, activeDiscount = null, activeShippingQuote = null;
const discountCodes = {
  FOUNDER20:   { type:'fixed',   value:20,  label:'R20 off — Founder'        },
  DISCOVERY15: { type:'percent', value:15,  label:'15% off order subtotal'    },
  SAMPLE25:    { type:'fixed',   value:25,  label:'R25 off order subtotal'    }
};
function setStatus(id, msg, kind) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = msg;
  el.style.color = kind==='error' ? '#FF8C00' : kind==='success' ? 'var(--cyan)' : 'var(--muted)';
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  tryAutoApplyDiscount();
  ['ship-phone','ship-province','ship-address-line1','ship-suburb','ship-city','ship-postal-code'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener(el.tagName==='SELECT'?'change':'input', () =>
      setStatus('shipping-validation-status','Details saved. Tap Refresh if you changed location.','info'));
  });
  const form = document.getElementById('payfast-form');
  if (form) form.addEventListener('submit', e => { if (!validatePay()) e.preventDefault(); });
  // nav dropdown
  const dd = document.getElementById('navCoffeeDropdown'), btn = document.getElementById('navCoffeeBtn');
  if (dd && btn) {
    btn.addEventListener('click', e => { e.stopPropagation(); const o = dd.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) { dd.classList.remove('open'); btn.setAttribute('aria-expanded','false'); } });
  }
  // nav anchor smooth scroll
  document.querySelectorAll('.nav-links a[href^="#"],.foot-links a[href^="#"]').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); scrollToSection(a.getAttribute('href')); dd && dd.classList.remove('open'); }));
});

// ── SIZE TOGGLE ──
function selectPF(btn, id, amount) {
  const g = btn.closest('.sz-toggle');
  const ac = (g.querySelector('[class*="sel-"]')||{className:''}).className.match(/sel-\w/);
  g.querySelectorAll('.sz-btn').forEach(b => b.className='sz-btn');
  btn.classList.add(ac ? ac[0] : 'sel-c');
  document.getElementById(id+'-p').textContent = amount;
  g.setAttribute('data-selected-size', btn.textContent.split(' —')[0].trim());
}

// ── QTY ──
function changeProductQty(id, d) {
  productQtys[id] = Math.max(1, (productQtys[id]||1)+d);
  const el = document.getElementById(id+'-qty'); if (el) el.textContent = productQtys[id];
}

// ── BEAN ACCORDION ──
function toggleBean(id) {
  const acc = document.getElementById('bean-'+id);
  const isOpen = acc.classList.toggle('open');
  acc.querySelector('.bean-toggle').setAttribute('aria-expanded', isOpen);
  document.querySelectorAll('.bean-accordion.open').forEach(a => { if (a!==acc) { a.classList.remove('open'); a.querySelector('.bean-toggle').setAttribute('aria-expanded','false'); } });
}

// ── CART ──
function prepAddToCart(name, id) {
  const priceEl = document.getElementById(id+'-p');
  const price = parseFloat((priceEl?priceEl.textContent:'0').replace(/[^0-9.]/g,''))||0;
  const sz = document.getElementById('sz-'+id);
  const size = sz ? sz.getAttribute('data-selected-size') : '1kg';
  const qty = productQtys[id]||1;
  const existing = cart.find(i => i.name===name && i.price===price && i.size===size);
  if (existing) existing.qty += qty;
  else cart.push({ name, price, size, qty, id: id+Date.now() });
  productQtys[id] = 1;
  const qEl = document.getElementById(id+'-qty'); if (qEl) qEl.textContent = 1;
  saveCart(); updateCartBadge(); flashBtn(id);
  currentUser ? showShipping() : showAccount();
}
function prepAddFixedProduct(name, id, price, size) {
  const existing = cart.find(i => i.name===name && i.price===price && i.size===size);
  if (existing) existing.qty++;
  else cart.push({ name, price, size, qty:1, id:id+Date.now() });
  saveCart(); updateCartBadge(); flashBtn(id);
  currentUser ? showShipping() : showAccount();
}
function flashBtn(id) {
  const btn = document.getElementById('btn-'+id); if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = 'Added ✓'; btn.style.opacity = '0.7';
  setTimeout(() => { btn.textContent = orig; btn.style.opacity = ''; }, 1500);
}
function saveCart() { localStorage.setItem('coffee_cart', JSON.stringify(cart)); }
function updateCartBadge() {
  const b = document.getElementById('cart-badge'), n = cart.reduce((s,i)=>s+i.qty,0);
  if (b) { b.textContent=n; b.style.display=n>0?'inline-block':'none'; }
}
function removeFromCart(i) { cart.splice(i,1); saveCart(); updateCartBadge(); showShipping(); }
function changeQty(i, d) {
  if (!cart[i]) return;
  cart[i].qty += d;
  if (cart[i].qty<=0) cart.splice(i,1);
  saveCart(); updateCartBadge(); showShipping();
}

// ── DRAWER ──
function openCart() {
  currentUser ? showShipping() : showAccount();
}
function showAccount() {
  document.getElementById('cartDrawer').classList.add('active');
  document.getElementById('step-account').style.display='block';
  document.getElementById('step-shipping').style.display='none';
  const stat = document.getElementById('guest-status'); if (stat) stat.textContent='';
}
function showShipping() {
  document.getElementById('cartDrawer').classList.add('active');
  document.getElementById('step-account').style.display='none';
  document.getElementById('step-shipping').style.display='block';
  renderCart(); calcTotal();
}
function closeCart() { document.getElementById('cartDrawer').classList.remove('active'); }
function continueAsGuest() {
  const name = (document.getElementById('guest-name')||{}).value?.trim();
  const email = (document.getElementById('guest-email')||{}).value?.trim();
  const stat = document.getElementById('guest-status');
  if (!name) { if(stat) { stat.textContent='Please enter your name.'; stat.style.color='#FF8C00'; } return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if(stat) { stat.textContent='Please enter a valid email address.'; stat.style.color='#FF8C00'; } return; }
  currentUser = { name, email };
  showShipping();
}
function renderCart() {
  const el = document.getElementById('cart-list');
  if (!cart.length) { el.innerHTML='<div style="text-align:center;padding:20px;color:#666;">Your cart is empty.</div>'; return; }
  el.innerHTML = cart.map((item,i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #222;padding:12px 0;">
      <div style="flex:1;"><div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:white;">${item.name} <span style="font-size:14px;color:var(--cyan)">${item.size||''}</span></div><div style="font-size:12px;color:#555;">R ${item.price.toFixed(2)} each</div></div>
      <div style="display:flex;align-items:center;gap:8px;margin:0 12px;">
        <button onclick="changeQty(${i},-1)" style="background:none;border:1px solid #333;color:#888;width:24px;height:24px;cursor:pointer;">-</button>
        <span style="font-family:monospace;min-width:20px;text-align:center;">${item.qty}</span>
        <button onclick="changeQty(${i},1)" style="background:none;border:1px solid #333;color:#888;width:24px;height:24px;cursor:pointer;">+</button>
      </div>
      <div style="text-align:right;min-width:70px;"><div style="font-family:monospace;color:white;">R ${(item.price*item.qty).toFixed(2)}</div><button onclick="removeFromCart(${i})" style="background:none;border:none;color:var(--cyan);font-size:10px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Remove</button></div>
    </div>`).join('');
}

// ── TOTAL / PAYFAST ──
function calcTotal() {
  const sel = document.getElementById('tcg-shipping');
  const opt = sel && sel.options[sel.selectedIndex];
  const ship = opt ? parseFloat(opt.getAttribute('data-rate')||opt.value||'0') : 0;
  const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);
  const disc = getDiscount(sub);
  const total = Math.max(0, sub-disc+ship);
  const el = document.getElementById('total-price');
  if (el) el.textContent = disc>0&&activeDiscount ? `Total: R ${total.toFixed(2)} (incl. ${activeDiscount.code} -R${disc.toFixed(2)})` : `Total: R ${total.toFixed(2)}`;
  updatePF(total);
}
function getDiscount(sub) {
  if (!activeDiscount||sub<=0) return 0;
  const r=activeDiscount.rule;
  return r.type==='percent' ? Math.min(sub,sub*r.value/100) : Math.min(sub,r.value);
}
function applyDiscountCode(code) {
  const inp = document.getElementById('discount-code-input');
  const c = (code||(inp?inp.value:'')||'').trim().toUpperCase();
  if (!c) { activeDiscount=null; setStatus('discount-status','Enter a code then tap Apply.','error'); calcTotal(); return; }
  const m = discountCodes[c];
  if (!m) { activeDiscount=null; setStatus('discount-status',`Code "${c}" not recognised.`,'error'); calcTotal(); return; }
  activeDiscount={code:c,rule:m}; if (inp) inp.value=c;
  setStatus('discount-status',`Applied ${c}: ${m.label}.`,'success'); calcTotal();
}
function tryAutoApplyDiscount() {
  const p = new URLSearchParams(window.location.search);
  const c = p.get('promo')||p.get('discount')||p.get('code'); if (!c) return;
  const inp = document.getElementById('discount-code-input'); if (inp) inp.value=c.toUpperCase();
  applyDiscountCode(c);
}
function updatePF(total) {
  const s=(id,v)=>{ const e=document.getElementById(id); if(e) e.value=v; };
  s('pf_amount',total.toFixed(2));
  s('pf_item_desc',cart.map(i=>`${i.qty}x ${i.name} (${i.size||'1kg'})`).join(', '));
  if (currentUser) { s('pf_name',currentUser.name); s('pf_email',currentUser.email); }
  s('pf_payment_id','ORD-'+Date.now());
  const pn=document.getElementById('pf_item_name'); if(pn&&!pn.value) pn.value='Artifacts Coffee Order';
  s('pf_discount_code',activeDiscount?activeDiscount.code:'');
  const sel=document.getElementById('tcg-shipping'), opt=sel&&sel.options[sel.selectedIndex];
  s('pf_shipping_method',opt?opt.textContent.trim():'');
  s('pf_shipping_amount',opt?(opt.getAttribute('data-rate')||opt.value||'0'):'0');
  const a=addr(); s('pf_shipping_address',[a.line1,a.suburb,a.city,a.province,a.postalCode].filter(Boolean).join(', ').slice(0,255));
  s('pf_shipping_phone',(a.phone||'').slice(0,100));
}
function addr() {
  const g=id=>{ const e=document.getElementById(id); return e?e.value.trim():''; };
  return { phone:g('ship-phone'),line1:g('ship-address-line1'),suburb:g('ship-suburb'),city:g('ship-city'),province:g('ship-province'),postalCode:g('ship-postal-code') };
}
function validatePay() {
  if (!cart.length) { alert('Your cart is empty.'); return false; }
  const a=addr(), req=['phone','line1','suburb','city','province','postalCode'], miss=req.filter(k=>!a[k]);
  if (miss.length) { setStatus('shipping-validation-status','Please complete: '+miss.join(', ').replace('line1','street address')+'.','error'); alert('Please complete your delivery details.'); return false; }
  setStatus('shipping-validation-status','Details good. Proceeding to PayFast...','info');
  calcTotal(); return true;
}

// ── SHIPPING ──
function getCartKg() {
  return cart.reduce((s,i)=>{ const sz=(i.size||'').toLowerCase(); const kg=sz.match(/([0-9.]+)\s*kg/); if(kg) return s+parseFloat(kg[1])*i.qty; const g=sz.match(/([0-9]+)\s*g/); if(g) return s+parseFloat(g[1])/1000*i.qty; return s+i.qty; },0)||1;
}
async function fetchShippingQuotes() {
  const a=addr(), stat='shipping-rate-status';
  if (!a.province||!a.postalCode) { setStatus(stat,'Select province and enter postal code first.','error'); return; }
  setStatus(stat,'Fetching courier rates...','info');
  const fb=[{code:'pudo',label:'TCG PUDO Locker',amount:60},{code:'door-gauteng',label:'Gauteng Door-to-Door',amount:100},{code:'door-national',label:'Rest of SA Door-to-Door',amount:150}];
  try {
    const res=await fetch('/.netlify/functions/getShipping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:a,cartItems:cart.map(i=>({name:i.name,size:i.size,qty:i.qty})),totalWeightKg:getCartKg(),subtotal:cart.reduce((s,i)=>s+i.price*i.qty,0)})});
    if (res.status===404) { renderShipOpts(fb,a.province); setStatus(stat,'Standard rates shown. Redeploy for live quotes.','error'); return; }
    if (!res.ok) throw new Error();
    const d=await res.json(); const q=d.quotes&&d.quotes.length?d.quotes:fb;
    activeShippingQuote=q[0]; renderShipOpts(q,a.province);
    setStatus(stat,d.source==='fallback'?'Live rates unavailable — standard rates shown.':'Rates updated.','info');
  } catch(e) { renderShipOpts(fb,a.province); setStatus(stat,'Could not reach shipping service — standard rates applied.','error'); }
}
function renderShipOpts(quotes,province) {
  const sel=document.getElementById('tcg-shipping'); if (!sel) return;
  sel.innerHTML=quotes.map(q=>{ const a=Number(q.amount||0); return `<option value="${a}" data-rate="${a}" data-code="${q.code||''}">${q.label||'Courier'} - R${a.toFixed(2)}</option>`; }).join('');
  const pref=(province||'').trim().toLowerCase()==='gauteng'?'door-gauteng':'door-national';
  const idx=quotes.findIndex(q=>q.code===pref); if (idx>=0) sel.selectedIndex=idx;
  calcTotal();
}

// ── UI ──
function toggleMob() {
  const o=document.getElementById('mobOverlay'),h=document.getElementById('navHam');
  if (o.classList.contains('active')) { closeMob(); return; }
  o.classList.add('active'); h.classList.add('open'); document.body.style.overflow='hidden';
  history.pushState({menu:'open'},'');
}
function closeMob() {
  const o=document.getElementById('mobOverlay'),h=document.getElementById('navHam');
  if (!o||!o.classList.contains('active')) return;
  o.classList.remove('active'); if(h) h.classList.remove('open'); document.body.style.overflow='';
  if (history.state&&history.state.menu==='open') history.back();
}
function closeMobInternal() {
  const o=document.getElementById('mobOverlay'),h=document.getElementById('navHam');
  if(o) o.classList.remove('active'); if(h) h.classList.remove('open'); document.body.style.overflow='';
}
function scrollToSection(target, replace=false) {
  const dest=document.querySelector(target); if (!dest) return;
  const nav=document.querySelector('nav'), off=(nav?nav.offsetHeight:0)+24;
  const top=dest.getBoundingClientRect().top+window.pageYOffset-off;
  if (window.location.hash!==target) history[replace?'replaceState':'pushState'](null,'',target);
  window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
}
function navigateMob(e,target) { e.preventDefault(); closeMobInternal(); scrollToSection(target,history.state&&history.state.menu==='open'); }
window.addEventListener('popstate',()=>{ closeMobInternal(); closeCart(); });
window.addEventListener('keydown',e=>{ if(e.key==='Escape'){closeCart();closeMob();} });
function tFaq(btn) {
  const item=btn.closest('.faq-item'),ans=item.querySelector('.faq-ans'),open=item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(i=>{ i.classList.remove('open'); i.querySelector('.faq-ans').style.maxHeight='0'; i.querySelector('.faq-q').setAttribute('aria-expanded','false'); });
  if (!open) { item.classList.add('open'); ans.style.maxHeight=ans.scrollHeight+'px'; btn.setAttribute('aria-expanded','true'); }
}
const io=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);} }),{threshold:0.05,rootMargin:'0px 0px 120px 0px'});
document.querySelectorAll('.reveal').forEach(r=>io.observe(r));
(function(){
  document.querySelectorAll('.hero .reveal').forEach((el,i)=>{ el.style.transitionDelay=(i*0.14)+'s'; requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in'))); });
})();

// ── FOUNDER ──
const FOUNDER_TOTAL=20, FOUNDER_BASELINE=3;
const SUPA='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhweGJsZHlyaWdxamtkbXJmaHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTA0OTcsImV4cCI6MjA5MTcyNjQ5N30.5dClUhDfHZ_IXs5b3ZEh6Zyg7WkZi04VZOBeqR4jOsk';
async function loadFounderCount() {
  let online=0;
  try { const r=await fetch('https://xpxbldyrigqjkdmrfhvh.supabase.co/rest/v1/point_events?select=id&description=ilike.*FOUNDER20*',{headers:{'apikey':SUPA,'Authorization':'Bearer '+SUPA}}); if(r.ok){const d=await r.json();online=Array.isArray(d)?d.length:0;} } catch(e){}
  const rem=Math.max(0,FOUNDER_TOTAL-Math.min(FOUNDER_TOTAL,FOUNDER_BASELINE+online));
  const el=document.getElementById('founder-spots'); if(el){el.textContent=rem;el.style.color=rem<=5?'#ff6b6b':'var(--yellow)';}
  if (rem===0) { const b=document.getElementById('founder-offer');if(b)b.style.display='none';delete discountCodes['FOUNDER20']; }
}
function copyFounderCode() {
  navigator.clipboard.writeText('FOUNDER20').then(()=>{ const b=document.querySelector('.founder-copy-btn');if(b){b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',2000);} });
}
loadFounderCount();
