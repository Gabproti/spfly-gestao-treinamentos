(function () {
  'use strict';

  const encoder = new TextEncoder();
  const assetBase = new URL('.',document.currentScript?.src || location.href);
  const bytes = value => encoder.encode(value);
  const longDate = value => new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(value));

  function wrap(context, value, maxWidth) {
    const words = String(value || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  const shortDate = value => value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(new Date(value)) : '—';
  const hours = minutes => Number(minutes)<=60 ? `${Number(minutes)||0} minutos` : `${Math.floor(Number(minutes)/60)}h ${String(Number(minutes)%60).padStart(2,'0')}min`;

  function rounded(context,x,y,width,height,radius) {
    const r=Math.min(radius,width/2,height/2);
    context.beginPath(); context.moveTo(x+r,y); context.lineTo(x+width-r,y);
    context.quadraticCurveTo(x+width,y,x+width,y+r); context.lineTo(x+width,y+height-r);
    context.quadraticCurveTo(x+width,y+height,x+width-r,y+height); context.lineTo(x+r,y+height);
    context.quadraticCurveTo(x,y+height,x,y+height-r); context.lineTo(x,y+r);
    context.quadraticCurveTo(x,y,x+r,y); context.closePath();
  }

  function centeredLines(context,lines,y,step,center=790) {
    context.textAlign='center';
    for (const line of lines) { context.fillText(line,center,y); y+=step; }
    return y-step;
  }

  function identityGeometry(context,snapshot) {
    context.font='bold 48px Arial';
    const nameLines=wrap(context,snapshot.employee_name,800);
    context.font='bold 38px Arial';
    const trackLines=wrap(context,snapshot.track_name,800);
    const nameStart=nameLines.length+trackLines.length>3 ? 365 : 385;
    const nameEnd=nameStart+(nameLines.length-1)*52;
    const trailEnd=nameEnd+108+(trackLines.length-1)*42;
    return {nameLines,trackLines,nameStart,nameEnd,trailEnd,tableTop:Math.max(590,trailEnd+85)};
  }

  function rowGeometry(context,course) {
    context.font='21px Arial';
    const lines=wrap(context,course.name,740);
    return {lines,height:Math.max(48,19+lines.length*27)};
  }

  function paginateCourses(context,certificate) {
    const source=Array.isArray(certificate.snapshot?.courses) ? certificate.snapshot.courses.filter(course=>course.completed_at) : [];
    const firstTop=identityGeometry(context,certificate.snapshot).tableTop;
    const pages=[]; let index=0;
    do {
      const top=pages.length ? 340 : firstTop;
      let room=872-(top+104),list=[];
      while(index<source.length) {
        const size=rowGeometry(context,source[index]).height;
        if(size>room && list.length) break;
        if(size>room && !pages.length) break;
        list.push(source[index++]); room-=size;
      }
      pages.push(list);
    } while(index<source.length);
    return pages;
  }

  function loadLogo() {
    return new Promise((resolve,reject) => {
      const logo = new Image();
      logo.onload = () => resolve(logo);
      logo.onerror = () => reject(new Error('Não foi possível carregar o logo da SPFLY.'));
      logo.src = 'data:image/png;base64,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';
    });
  }

  function drawFrame(context,logo) {
    const c=context;
    c.fillStyle='#fff'; c.fillRect(0,0,1584,1120);
    c.save(); c.globalAlpha=0.045;
    c.fillStyle='#222930';
    c.beginPath(); c.moveTo(0,395); c.lineTo(420,230); c.lineTo(165,595); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(0,615); c.lineTo(420,230); c.lineTo(360,790); c.closePath(); c.fill();
    c.fillStyle='#ee5b20';
    c.beginPath(); c.moveTo(0,585); c.lineTo(345,725); c.lineTo(0,770); c.closePath(); c.fill();
    c.restore();
    c.fillStyle='#1b1d20'; c.beginPath(); c.moveTo(0,0); c.lineTo(900,0); c.lineTo(0,260); c.closePath(); c.fill();
    c.strokeStyle='#f05a20'; c.lineWidth=13; c.beginPath(); c.moveTo(0,260); c.lineTo(900,0); c.stroke();
    c.drawImage(logo,70,43,390,94);
    c.textAlign='right'; c.fillStyle='#212b38'; c.font='bold 18px Arial';
    c.fillText('C A P A C I T A Ç Ã O',1470,56);
    c.fillText('DESENVOLVIMENTO',1470,86);
    c.fillText('PESSOAS  •  RESULTADOS',1470,116);
    c.fillStyle='#1b1d20'; c.beginPath(); c.moveTo(0,986); c.lineTo(565,1120); c.lineTo(0,1120); c.closePath(); c.fill();
    c.strokeStyle='#f05a20'; c.lineWidth=18; c.beginPath(); c.moveTo(0,984); c.lineTo(565,1120); c.stroke();
    c.fillStyle='#1b1d20'; c.beginPath(); c.moveTo(1584,984); c.lineTo(1030,1120); c.lineTo(1584,1120); c.closePath(); c.fill();
    c.strokeStyle='#f05a20'; c.lineWidth=18; c.beginPath(); c.moveTo(1584,984); c.lineTo(1030,1120); c.stroke();
  }

  function drawTable(context,courses,top) {
    const c=context,left=115,width=1354,innerLeft=135,innerWidth=1314;
    const rows=courses.map(course=>({course,...rowGeometry(c,course)}));
    const height=104+rows.reduce((sum,row)=>sum+row.height,0);
    c.fillStyle='#fff';c.strokeStyle='#dfe3e7';c.lineWidth=2;
    rounded(c,left,top,width,height,22);c.fill();c.stroke();
    c.fillStyle='#f05a20';c.beginPath();c.arc(164,top+32,31,0,Math.PI*2);c.fill();
    c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();
    c.moveTo(146,top+22);c.quadraticCurveTo(157,top+17,164,top+28);
    c.quadraticCurveTo(171,top+17,182,top+22);
    c.lineTo(182,top+45);c.quadraticCurveTo(171,top+39,164,top+50);
    c.quadraticCurveTo(157,top+39,146,top+45);c.closePath();c.stroke();
    c.beginPath();c.moveTo(164,top+28);c.lineTo(164,top+50);c.stroke();
    c.textAlign='left';c.fillStyle='#14191f';c.font='bold 24px Arial';c.fillText('CURSOS REALIZADOS',215,top+40);
    c.fillStyle='#272b30';rounded(c,innerLeft,top+62,innerWidth,42,9);c.fill();
    c.fillStyle='#fff';c.font='bold 17px Arial';c.textAlign='left';c.fillText('CURSO',160,top+90);
    c.textAlign='center';c.fillText('CARGA HORÁRIA',1025,top+90);c.fillText('DATA DE CONCLUSÃO',1292,top+90);
    let rowTop=top+104;
    rows.forEach((row,index)=>{
      c.fillStyle=index%2?'#f7f8fa':'#fff';c.fillRect(innerLeft,rowTop,innerWidth,row.height);
      c.strokeStyle='#d7dce0';c.lineWidth=1;c.beginPath();c.moveTo(innerLeft,rowTop+row.height);c.lineTo(innerLeft+innerWidth,rowTop+row.height);c.stroke();
      c.fillStyle='#1f2933';c.font='21px Arial';c.textAlign='left';
      let textY=rowTop+(row.height-row.lines.length*27)/2+22;
      for(const line of row.lines){c.fillText(line,160,textY);textY+=27;}
      c.textAlign='center';c.font='20px Arial';c.fillText(hours(row.course.duration_minutes),1025,rowTop+row.height/2+7);
      c.fillText(shortDate(row.course.completed_at),1292,rowTop+row.height/2+7);
      rowTop+=row.height;
    });
    c.strokeStyle='#d7dce0';c.beginPath();c.moveTo(915,top+62);c.lineTo(915,rowTop);
    c.moveTo(1135,top+62);c.lineTo(1135,rowTop);c.stroke();
  }

  function drawPage(context,certificate,logo,courses,pageNumber,pageCount) {
    const c=context,snapshot=certificate.snapshot;
    drawFrame(c,logo);
    if(pageNumber===1){
      c.textAlign='center';c.fillStyle='#1b1d20';c.font='bold 72px Arial';c.fillText('CERTIFICADO',765,205);
      c.fillStyle='#f05a20';c.font='bold 48px Arial';c.fillText('DE CONCLUSÃO',765,263);
      c.fillStyle='#26313d';c.font='22px Arial';c.fillText('A SPFLY LOGÍSTICA CONFERE ESTE CERTIFICADO A',765,322);
      const geo=identityGeometry(c,snapshot);
      c.fillStyle='#14191f';c.font='bold 48px Arial';centeredLines(c,geo.nameLines,geo.nameStart,52,765);
      c.strokeStyle='#f05a20';c.lineWidth=2;c.beginPath();c.moveTo(390,geo.nameEnd+15);c.lineTo(1135,geo.nameEnd+15);c.stroke();
      c.fillStyle='#26313d';c.font='22px Arial';c.fillText('por ter concluído com êxito a Trilha de Capacitação',765,geo.nameEnd+52);
      c.fillStyle='#ed5721';c.font='bold 38px Arial';centeredLines(c,geo.trackLines,geo.nameEnd+108,42,765);
      c.fillStyle='#4b5560';c.font='20px Arial';
      c.fillText('em reconhecimento à dedicação e ao desenvolvimento profissional',765,geo.trailEnd+43);
      c.fillText('em sintonia com os valores da SPFLY Logística.',765,geo.trailEnd+70);
      if(courses.length) drawTable(c,courses,geo.tableTop);
    }else{
      c.textAlign='center';c.fillStyle='#1b1d20';c.font='bold 50px Arial';c.fillText('CURSOS REALIZADOS',795,220);
      c.fillStyle='#ef5c20';c.font='bold 27px Arial';
      centeredLines(c,wrap(c,snapshot.track_name,950),260,32,795);
      drawTable(c,courses,340);
    }
    if(pageNumber===1){
      c.strokeStyle='#ef5c20';c.lineWidth=5;c.beginPath();c.arc(225,923,25,0,Math.PI*2);c.stroke();
      c.beginPath();c.moveTo(225,907);c.lineTo(225,923);c.lineTo(238,931);c.stroke();
      c.textAlign='left';
      c.fillStyle='#27313a';c.font='bold 17px Arial';c.fillText('CARGA HORÁRIA TOTAL',270,910);
      c.fillStyle='#111820';c.font='bold 27px Arial';c.fillText(hours(snapshot.total_minutes),270,944);
      c.strokeStyle='#ef5c20';c.lineWidth=5;c.strokeRect(643,904,40,38);
      c.beginPath();c.moveTo(643,915);c.lineTo(683,915);c.moveTo(652,899);c.lineTo(652,910);
      c.moveTo(674,899);c.lineTo(674,910);c.stroke();
      c.fillStyle='#ef5c20';c.fillRect(652,923,6,6);c.fillRect(667,923,6,6);c.fillRect(652,932,6,6);
      c.fillStyle='#27313a';c.font='bold 17px Arial';c.fillText('DATA DE CONCLUSÃO',710,910);
      c.fillStyle='#111820';c.font='bold 25px Arial';c.fillText(longDate(snapshot.completed_at),710,944);
      c.strokeStyle='#ed5b20';c.lineWidth=2;c.beginPath();c.moveTo(1085,969);c.lineTo(1460,969);c.stroke();
      c.fillStyle='#14191f';c.textAlign='center';c.font='bold 19px Arial';
      c.fillText('SPFLY LOGÍSTICA',1272,997);c.font='16px Arial';c.fillText('GESTÃO DE PESSOAS',1272,1021);
    }else{
      c.textAlign='right';c.fillStyle='#47515c';c.font='19px Arial';
      c.fillText(`${snapshot.employee_name} · ${longDate(snapshot.completed_at)}`,1460,925);
    }
    if(pageCount>1){c.textAlign='center';c.fillStyle='#66717a';c.font='16px Arial';c.fillText(`Página ${pageNumber} de ${pageCount}`,790,1075);}
  }

  async function makeJpegs(certificate) {
    const logo=await loadLogo();
    const measure=document.createElement('canvas').getContext('2d');
    const batches=paginateCourses(measure,certificate),pages=[];
    for(let i=0;i<batches.length;i++){
      const canvas=document.createElement('canvas');canvas.width=1584;canvas.height=1120;
      drawPage(canvas.getContext('2d'),certificate,logo,batches[i],i+1,batches.length);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Falha ao gerar a página do certificado.')),'image/jpeg',0.94));
      pages.push(new Uint8Array(await blob.arrayBuffer()));
    }
    return pages;
  }

  function buildPdf(images) {
    const pieces=[]; const offsets=[0]; let position=0;
    function append(part) { const data=typeof part==='string'?bytes(part):part; pieces.push(data); position+=data.length; }
    function object(number,body) { offsets[number]=position; append(`${number} 0 obj\n${body}\nendobj\n`); }
    append('%PDF-1.4\n');
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    const pageIds=images.map((_,i)=>3+i*3);
    object(2,`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${images.length} >>`);
    images.forEach((image,i)=>{
      const page=3+i*3, content=page+1, photo=page+2;
      object(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im0 ${photo} 0 R >> >> /Contents ${content} 0 R >>`);
      const commands=bytes('q\n842 0 0 595 0 0 cm\n/Im0 Do\nQ\n');
      offsets[content]=position;
      append(`${content} 0 obj\n<< /Length ${commands.length} >>\nstream\n`); append(commands); append('endstream\nendobj\n');
      offsets[photo]=position;
      append(`${photo} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1584 /Height 1120 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
      append(image); append('\nendstream\nendobj\n');
    });
    const xref=position, count=3+images.length*3;
    append(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for(let i=1;i<count;i++) append(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    append(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(pieces,{type:'application/pdf'});
  }

  async function download(certificate) {
    if (!certificate || certificate.status!=='valid' || !certificate.snapshot?.employee_name) throw new Error('Certificado indisponível.');
    const blob=buildPdf(await makeJpegs(certificate));
    const href=URL.createObjectURL(blob), link=document.createElement('a');
    const label=String(certificate.snapshot.track_name||'trilha').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
    link.href=href; link.download=`SPFLY-certificado-${label}.pdf`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(href),60000);
  }

  window.SPFLY_OFFICIAL_PDF={download,buildPdf,drawPage,paginateCourses};
})();
