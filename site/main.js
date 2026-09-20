/* 灵睿 LinkSight 产品展示站 —— 滚动动效。
   设计稿：docs/superpowers/specs/2026-09-05-showcase-site-design.md（§4 逐章、§5 转场）。
   规则：只动 transform / opacity / clip-path；钉住的 ScrollTrigger 必须先建。 */
(function(){
  /* ---- 素材装载：assets/<编号>.webp 在就贴上去，不在就留着那块带说明的格 ----
     图片 = <编号>.webp；录屏 = <编号>.webm + <编号>.mp4，海报帧用同名 .webp。
     先探海报帧：一张图探完就知道这套素材在不在，不会闪出半张坏图。 */
  function mountMedia(el){
    var id=el.dataset.id; if(!id||el.dataset.done) return; el.dataset.done='1';
    var probe=new Image();
    probe.onload=function(){
      var node;
      if(el.dataset.kind==='video'){
        node=document.createElement('video');
        node.muted=true; node.loop=true; node.playsInline=true; node.preload='none';
        node.setAttribute('playsinline',''); node.poster='assets/'+id+'.webp';
        node.setAttribute('aria-label',el.dataset.note||'');
        ['webm','mp4'].forEach(function(t){
          var src=document.createElement('source');
          src.src='assets/'+id+'.'+t; src.type=t==='webm'?'video/webm':'video/mp4';
          node.appendChild(src);
        });
      }else{
        node=document.createElement('img');
        node.src=probe.src; node.alt=el.dataset.note||''; node.loading='lazy'; node.decoding='async';
      }
      el.appendChild(node); el.classList.add('has-media');
    };
    probe.src='assets/'+id+'.webp';
  }
  document.querySelectorAll('[data-id][data-kind]').forEach(mountMedia);

  /* 录屏只在视口里播：离开就停，省电也省流量。没有 IntersectionObserver 就一直播。 */
  if(window.IntersectionObserver){
    var vio=new IntersectionObserver(function(es){
      es.forEach(function(e){
        var v=e.target.querySelector('video'); if(!v) return;
        if(e.isIntersecting){ var p=v.play(); if(p&&p.catch) p.catch(function(){}); } else { v.pause(); }
      });
    },{threshold:.25});
    document.querySelectorAll('[data-kind="video"]').forEach(function(el){vio.observe(el);});
  }

  /* 图标是构建时内联的静态 SVG（lucide 0.468.0 的 16 个），运行时不需要图标库 */

  /* ---- 分段控件 tab（大小园区）---- */
  (function(){
    var seg=document.getElementById('fit-seg'); if(!seg) return;
    var tabs=seg.querySelectorAll('[role="tab"]'), panels=document.querySelectorAll('.fit-panel');
    tabs.forEach(function(t,i){ t.addEventListener('click',function(){
      seg.dataset.i=i;
      tabs.forEach(function(x,j){x.setAttribute('aria-selected',String(j===i));});
      panels.forEach(function(p,j){p.classList.toggle('on',j===i);});
    }); });
  })();

  /* ---- 分段控件（经营分析）：桌面钉住时点了滚到对应进度；静态档当普通 tab ---- */
  var dashTl=null;
  (function(){
    var seg=document.getElementById('dash-seg'); if(!seg) return;
    var tabs=seg.querySelectorAll('[role="tab"]'), views=document.querySelectorAll('#dashboard .view'), lines=document.querySelectorAll('#dashboard .dash-lines p');
    tabs.forEach(function(t,i){ t.addEventListener('click',function(){
      if(dashTl){ var st=dashTl.scrollTrigger, p=(dashTl.labels['v'+i]+0.35)/dashTl.duration(); window.scrollTo({top:st.start+(st.end-st.start)*p,behavior:'smooth'}); return; }
      seg.dataset.i=i; tabs.forEach(function(x,j){x.setAttribute('aria-selected',String(j===i));});
      views.forEach(function(v,j){v.classList.toggle('on',j===i);}); lines.forEach(function(v,j){v.classList.toggle('on',j===i);});
    }); });
  })();

  /* ---- 光伏示例图：某栋 ÷ 全园中位，最后九天跌出带。主线次级灰，尾点是整张图唯一的彩色 ---- */
  var pvPlayed=false;
  drawPv();
  if(window.ResizeObserver){ var pvEl=document.getElementById('pv-chart'); if(pvEl) new ResizeObserver(function(){drawPv();}).observe(pvEl); }
  function drawPv(){
    var svg=document.getElementById('pv-chart'); if(!svg) return;
    /* viewBox 跟随渲染尺寸：SVG 用户单位 = CSS px，11px 标注不会被压缩 */
    var W=Math.round(svg.clientWidth)||600,H=Math.round(svg.clientHeight)||140,pl=34,pr=14,pt=10,pb=22, n=30;
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    var x=function(i){return pl+(W-pl-pr)*i/(n-1);};
    var y=function(v){return pt+(H-pt-pb)*(1-(v-0.5)/1.0);};
    var lo=[],hi=[],line=[];
    for(var i=0;i<n;i++){
      var wob=Math.sin(i*0.7)*0.03;
      lo.push(0.86+wob); hi.push(1.16+wob);
      var v=1.01+Math.sin(i*1.3)*0.06+Math.cos(i*0.4)*0.04;
      if(i>=21) v=0.80-(i-21)*0.028+Math.sin(i)*0.015;
      line.push(v);
    }
    var band='M'+lo.map(function(v,i){return x(i)+','+y(hi[i]);}).join('L')+'L'+lo.slice().reverse().map(function(v,i){var k=n-1-i;return x(k)+','+y(lo[k]);}).join('L')+'Z';
    var path='M'+line.map(function(v,i){return x(i)+','+y(v);}).join('L');
    var ticks=[0.6,1.0,1.4].map(function(t){return '<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y(t)+'" y2="'+y(t)+'" style="stroke:var(--hair)"/><text x="'+(pl-8)+'" y="'+(y(t)+4)+'" text-anchor="end" style="fill:var(--fg-3);font:11px var(--font)">'+t.toFixed(1)+'</text>';}).join('');
    var days=[1,10,20,30].map(function(d){return '<text x="'+x(d-1)+'" y="'+(H-8)+'" text-anchor="middle" style="fill:var(--fg-3);font:11px var(--font)">'+d+'日</text>';}).join('');
    var last=n-1;
    svg.innerHTML=ticks+days+
      '<path d="'+band+'" style="fill:color-mix(in srgb,var(--fg) 8%,transparent)"/>'+
      '<path class="pv-line" d="'+path+'" style="fill:none;stroke:var(--fg-2);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>'+
      '<circle cx="'+x(last)+'" cy="'+y(line[last])+'" r="5" style="fill:var(--warn)"/>'+
      '<text x="'+(x(last)-14)+'" y="'+(y(line[last])-20)+'" text-anchor="end" style="fill:var(--warn);font:600 11px var(--font)">跌出正常带 9 天</text>';
    var p=svg.querySelector('.pv-line');
    if(p&&window.gsap&&!pvPlayed&&!document.body.classList.contains('static')){ var L=p.getTotalLength(); p.style.strokeDasharray=L; p.style.strokeDashoffset=L; }
  }
  function playPv(){
    var p=document.querySelector('.pv-line'); if(!p||pvPlayed) return; pvPlayed=true;
    var L=p.getTotalLength(); gsap.fromTo(p,{strokeDasharray:L,strokeDashoffset:L},{strokeDashoffset:0,duration:1.2,ease:'power2.inOut'});
  }

  /* 没有 gsap（拦了脚本、断网、老浏览器）：body 上的 static final 原样留着，终态本来就可读 */
  if(!window.gsap||!window.ScrollTrigger){ return; }
  gsap.registerPlugin(ScrollTrigger);

  var mm=gsap.matchMedia();
  mm.add({
    desk:'(min-width: 900px) and (prefers-reduced-motion: no-preference)',
    mob:'(max-width: 899px) and (prefers-reduced-motion: no-preference)',
    reduce:'(prefers-reduced-motion: reduce)'
  },function(ctx){
    var c=ctx.conditions;
    var cl=document.body.classList;
    if(c.reduce){ cl.add('static','final'); drawPv(); return; }   /* 两个类都留着 = 全部终态 */
    cl.remove('final');                                           /* 协作双窗要播一次，两档都播 */
    if(c.mob){ cl.add('static'); } else { cl.remove('static'); }

    /* 先建钉住的 ScrollTrigger，再建其余：否则后者按「无钉住」的位置算触发点，会提前几千像素触发 */
    if(c.desk){ before(); chain(); bill(); hinge(); dashboard(); pool(); }
    navSpy(); hero(); counters(); reveals(); collab();
  });

  function navSpy(){
    document.querySelectorAll('.nav-links a').forEach(function(a){
      var sec=document.getElementById(a.dataset.for); if(!sec) return;
      var opts={trigger:sec,start:'top 50%',end:'bottom 50%',onToggle:function(s){a.classList.toggle('on',s.isActive);}};
      if(a.dataset.for==='chain') opts.endTrigger='.pan-wrap'; /* 横滚区是兄弟节，高亮要覆盖到它 */
      ScrollTrigger.create(opts);
    });
  }

  /* ---- 00 首屏 ---- */
  function hero(){
    var tl=gsap.timeline({defaults:{ease:'power3.out'}});
    tl.from('.hero-copy > *',{y:22,opacity:0,duration:.9,stagger:.08})
      .from('.hero-stage',{y:60,opacity:0,duration:1.1},'-=.6');
    gsap.to('.hero-copy',{y:-60,opacity:0,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom 45%',scrub:true}});
  }

  /* ---- 数字计数：只有底座章 ---- */
  function counters(){
    document.querySelectorAll('[data-count]').forEach(function(el){
      var node=el.firstChild; var to=parseInt(node.textContent.replace(/\D/g,''),10); if(!to) return;
      var o={v:0};
      gsap.to(o,{v:to,duration:1.4,ease:'power2.out',snap:{v:1},onUpdate:function(){node.textContent=o.v.toLocaleString('en-US');},scrollTrigger:{trigger:el,start:'top 88%',once:true}});
    });
  }

  /* ---- 进入视口上浮（一次性）---- */
  function reveals(){
    ScrollTrigger.batch('.rv',{start:'top 88%',once:true,onEnter:function(els){gsap.from(els,{y:24,opacity:0,duration:.8,ease:'power2.out',stagger:.07});}});
    ScrollTrigger.create({trigger:'.tile.pv',start:'top 80%',once:true,onEnter:playPv});
  }

  /* ---- 01 叠纸：下一张到来时上一张退后 ---- */
  function before(){
    var sheets=gsap.utils.toArray('.stack .sheet');
    sheets.forEach(function(s,i){
      if(i===sheets.length-1) return;
      gsap.to(s.querySelector('.paper'),{scale:.94,opacity:.45,y:-24,ease:'none',scrollTrigger:{trigger:sheets[i+1],start:'top bottom',end:'top top',scrub:true}});
    });
  }

  /* ---- 02 出账链：竖滚转横移，节点逐段点亮，当前节点香槟 ---- */
  function chain(){
    var wrap=document.querySelector('.pan-wrap'), track=wrap.querySelector('.pan-track');
    var dist=function(){return Math.max(0,track.scrollWidth-wrap.clientWidth);};
    var segs=gsap.utils.toArray('.step .seg'), dots=gsap.utils.toArray('.step .node i');
    var tl=gsap.timeline({scrollTrigger:{trigger:wrap,start:'top top',end:function(){return '+='+dist();},pin:true,scrub:.8,invalidateOnRefresh:true,anticipatePin:1}});
    tl.to(track,{x:function(){return -dist();},ease:'none',duration:1},0);
    var n=dots.length;
    dots.forEach(function(d,i){
      var t=i/n;
      tl.to(d,{backgroundColor:'#C9B790',duration:.03},t);
      if(i<n-1) tl.to(d,{backgroundColor:'#f5f5f7',duration:.03},(i+1)/n);
      if(segs[i]) tl.to(segs[i],{scaleX:1,ease:'none',duration:1/n},t);
    });
  }

  /* ---- 03 催缴单：钉住换画面，入口从卡片尺寸放大 ---- */
  function bill(){
    var caps=gsap.utils.toArray('#bill .cap'), views=gsap.utils.toArray('#bill .view');
    gsap.set(caps.slice(1),{opacity:0,y:32}); gsap.set(views.slice(1),{opacity:0,scale:1.03});
    gsap.from('#bill .screen',{scale:.82,transformOrigin:'left center',ease:'power3.out',duration:.6,scrollTrigger:{trigger:'#bill',start:'top 60%',once:true}});
    var tl=gsap.timeline({scrollTrigger:{trigger:'#bill',start:'top top',end:'+=260%',pin:true,scrub:.5,anticipatePin:1}});
    for(var i=1;i<caps.length;i++){
      tl.to({},{duration:.6})
        .to(caps[i-1],{opacity:0,y:-32,duration:1})
        .to(views[i-1],{opacity:0,scale:.985,duration:1},'<')
        .to(caps[i],{opacity:1,y:0,duration:1},'<+=.35')
        .to(views[i],{opacity:1,scale:1,duration:1},'<');
    }
    tl.to({},{duration:.8});
  }

  /* ---- 04 转轴：引线随滚动画到下一章顶边 ---- */
  function hinge(){
    gsap.to('.hinge .line',{scaleY:1,ease:'none',scrollTrigger:{trigger:'.hinge .line',start:'top 85%',end:'bottom 60%',scrub:true}});
  }

  /* ---- 05 经营分析：钉住换画面，分段控件当进度（点击见上面的 dash-seg 绑定）---- */
  function dashboard(){
    var views=gsap.utils.toArray('#dashboard .view'), lines=gsap.utils.toArray('#dashboard .dash-lines p');
    var seg=document.getElementById('dash-seg'), thumb=seg.querySelector('.thumb'), tabs=seg.querySelectorAll('[role="tab"]');
    gsap.set(views.slice(1),{opacity:0,scale:1.03}); gsap.set(lines.slice(1),{opacity:0,y:10});
    var cur=0;
    var tl=gsap.timeline({
      onUpdate:function(){ /* 标签落在每段画面到位处，白字随播放头翻，与滑块共用同一时间轴 */
        var t=tl.time(), i=t>=tl.labels.v3?3:t>=tl.labels.v2?2:t>=tl.labels.v1?1:0;
        if(i!==cur){ cur=i; tabs.forEach(function(b,j){b.setAttribute('aria-selected',String(j===i));}); }
      },
      scrollTrigger:{trigger:'#dashboard',start:'top top',end:'+=260%',pin:true,scrub:.5,anticipatePin:1}});
    tl.addLabel('v0').to({},{duration:.6});
    for(var i=1;i<views.length;i++){
      tl.to(views[i-1],{opacity:0,scale:.985,duration:1})
        .to(lines[i-1],{opacity:0,y:-10,duration:.6},'<')
        .to(views[i],{opacity:1,scale:1,duration:1},'<+=.2')
        .to(lines[i],{opacity:1,y:0,duration:.6},'<+=.2')
        .to(thumb,{xPercent:100*i,duration:.6,ease:'power2.inOut'},'<-=.4')
        .addLabel('v'+i)
        .to({},{duration:.6});
    }
    tl.to({},{duration:.4});
    dashTl=tl;
  }

  /* ---- 07 公摊引擎：经过式揩开，不钉住 ---- */
  function pool(){
    var stage=document.querySelector('#pool .wipe');
    var tl=gsap.timeline({scrollTrigger:{trigger:stage,start:'top 80%',end:'top 20%',scrub:.5,invalidateOnRefresh:true}});
    tl.fromTo('#pool .layer.sys',{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',ease:'none',duration:1},0)
      .fromTo('#pool .wipe-bar',{x:0},{x:function(){return stage.clientWidth;},ease:'none',duration:1},0)
      .to('#pool .tag.l',{opacity:0,duration:.15},.75);
  }

  /* ---- 09 协作：进入视口播放一次，停在终态 ---- */
  function collab(){
    var tl=gsap.timeline({paused:true});
    tl.to('#pane-a .lockbtn',{scale:.96,duration:.1}).to('#pane-a .lockbtn',{scale:1,duration:.1})
      .to('#pane-a .s0',{opacity:0,duration:.25},'a').to('#pane-a .s1',{opacity:1,duration:.25},'a')
      .to('#pane-a .lockbtn',{borderColor:'#C9B790',color:'#C9B790',duration:.25},'a')
      .to('.who.other,.cnt.other',{opacity:1,duration:.4},'a+=.2')
      .to('#pane-a .who.me,#pane-b .who.other',{boxShadow:'0 0 0 2px #C9B790',duration:.25},'a+=.2')
      .to({},{duration:.5})
      .to('#pane-b .s0',{opacity:0,duration:.25},'b').to('#pane-b .s1',{opacity:1,duration:.25},'b')
      .to({},{duration:.6})
      .to('#pane-b .s1',{opacity:0,duration:.25},'c').to('#pane-b .s2',{opacity:1,duration:.25},'c')
      .to({},{duration:.5})
      .to('#pane-b .toast',{opacity:1,y:0,duration:.4});
    ScrollTrigger.create({trigger:'.panes',start:'top 70%',once:true,onEnter:function(){tl.play();}});
  }
})();
