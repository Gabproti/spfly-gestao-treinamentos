(function () {
  'use strict';
  const sidebar=document.querySelector('.sidebar');
  const app=document.querySelector('.app');
  const toggle=document.getElementById('sidebarTouchToggle');
  if(!sidebar||!app) return;
  const setExpanded=expanded=>{
    sidebar.classList.toggle('is-expanded',expanded);
    app.classList.toggle('sidebar-expanded',expanded);
    if(toggle){toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',expanded?'Recolher menu':'Expandir menu');}
  };
  sidebar.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'&&matchMedia('(hover: hover)').matches)setExpanded(true);});
  sidebar.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')setExpanded(false);});
  sidebar.addEventListener('focusin',event=>{if(event.target!==toggle)setExpanded(true);});
  sidebar.addEventListener('focusout',event=>{if(!sidebar.contains(event.relatedTarget))setExpanded(false);});
  toggle?.addEventListener('click',()=>setExpanded(!sidebar.classList.contains('is-expanded')));
  sidebar.querySelectorAll('.nav-btn').forEach(button=>{
    const label=button.querySelector('.nav-label')?.textContent.trim();
    if(label){button.title=label;button.setAttribute('aria-label',label);}
    if(button.dataset.page)button.addEventListener('click',()=>{
      if(matchMedia('(hover: none)').matches)setExpanded(false);
    });
  });
  const reports=sidebar.querySelector('[data-menu="reports"]');
  reports?.setAttribute('aria-controls','reports');
  reports?.setAttribute('aria-expanded',String(document.getElementById('reports')?.classList.contains('open')));
  reports?.addEventListener('click',()=>reports.setAttribute('aria-expanded',String(document.getElementById('reports')?.classList.contains('open'))));
  sidebar.querySelectorAll('.subnav [data-page]').forEach(button=>button.addEventListener('click',()=>{
    if(matchMedia('(hover: none)').matches)setExpanded(false);
  }));
  document.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch'&&!sidebar.contains(event.target))setExpanded(false);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setExpanded(false);});
})();
