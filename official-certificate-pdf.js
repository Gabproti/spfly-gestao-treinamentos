(function () {
  'use strict';

  const W = 842, H = 595;
  const ink = PDFLib.rgb(0.09, 0.11, 0.13);
  const orange = PDFLib.rgb(0.95, 0.34, 0.08);
  const grey = PDFLib.rgb(0.78, 0.80, 0.82);
  const assetBase = new URL('.', document.currentScript?.src || location.href);
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'
  });

  function durationLabel(minutes) {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value <= 0) throw new Error('Corrija a duração dos cursos da trilha antes de emitir o certificado.');
    if (value < 120) return `${value} ${value === 1 ? 'minuto' : 'minutos'}`;
    const whole = Math.floor(value / 60), rest = value % 60;
    return `${whole} ${whole === 1 ? 'hora' : 'horas'}${rest ? ` e ${rest} ${rest === 1 ? 'minuto' : 'minutos'}` : ''}`;
  }

  function certificateContent(certificate) {
    if (!certificate || certificate.status !== 'valid') throw new Error('Certificado indisponível.');
    const snapshot = certificate.snapshot || {};
    const employee = String(snapshot.employee_name || '').trim();
    const track = String(snapshot.track_name || '').trim();
    if (!employee) throw new Error('O nome do funcionário está ausente do certificado.');
    if (!track) throw new Error('O nome da trilha está ausente do certificado.');
    const courses = Array.isArray(snapshot.courses) ? snapshot.courses : [];
    const seen = new Set(); let minutes = 0;
    for (const course of courses) {
      if (!course?.completed_at) continue;
      const id = String(course.id || '').trim();
      if (!id) throw new Error('Um curso do certificado está sem identificação. Corrija o cadastro antes de emitir.');
      if (seen.has(id)) continue;
      seen.add(id);
      const value = Number(course.duration_minutes);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`Corrija a duração do curso “${course.name || id}” antes de emitir.`);
      minutes += value;
    }
    if (!seen.size || minutes !== Number(snapshot.total_minutes)) {
      throw new Error('A carga horária registrada não corresponde à soma dos cursos concluídos. Regularize os dados antes de emitir.');
    }
    const rawDate = certificate.completion_at || snapshot.completed_at;
    if (!rawDate || !Number.isFinite(new Date(rawDate).getTime())) {
      throw new Error('A data de conclusão da trilha não está registrada. Regularize os dados antes de emitir.');
    }
    const date = dateFormatter.format(new Date(rawDate));
    const mainParts = [
      {text: 'A SPFLY LOGÍSTICA certifica que ', bold: false},
      {text: employee, bold: true},
      {text: ' concluiu com êxito a Trilha de Capacitação ', bold: false},
      {text: track, bold: true},
      {text: ', com carga horária total de ', bold: false},
      {text: durationLabel(minutes), bold: true},
      {text: `, realizada no período de ${date}, adquirindo os conhecimentos e habilidades necessários conforme o programa estabelecido.`, bold: false}
    ];
    return {
      employee, track, minutes, date, mainParts,
      main: mainParts.map(part => part.text).join(''),
      recognition: 'Este certificado é concedido como reconhecimento do esforço e dedicação demonstrados ao longo do curso.'
    };
  }

  function wrapText(text, font, size, maxWidth) {
    const lines = []; let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    if (lines.some(item => font.widthOfTextAtSize(item, size) > maxWidth)) {
      throw new Error('O texto é extenso demais para o certificado em uma página. Revise o nome da trilha ou do funcionário.');
    }
    return lines;
  }

  function wrapRuns(parts, regular, bold, size, maxWidth) {
    const lines = []; let runs = [], width = 0, pendingSpace = false;
    const pushLine = () => { if (runs.length) lines.push({runs, width}); runs = []; width = 0; };
    for (const part of parts) {
      const face = part.bold ? bold : regular;
      for (const token of part.text.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) { pendingSpace = true; continue; }
        let spaceWidth = width && pendingSpace ? regular.widthOfTextAtSize(' ', size) : 0;
        const tokenWidth = face.widthOfTextAtSize(token, size);
        if (width && width + spaceWidth + tokenWidth > maxWidth) {
          pushLine(); spaceWidth = 0;
        }
        if (tokenWidth > maxWidth) throw new Error('Um nome é extenso demais para o certificado em uma página.');
        if (spaceWidth) { runs.push({advance: spaceWidth}); width += spaceWidth; }
        const previous = runs[runs.length - 1];
        if (previous && previous.advance == null && previous.bold === !!part.bold) previous.text += token;
        else runs.push({text: token, bold: !!part.bold});
        width += tokenWidth;
        pendingSpace = false;
      }
    }
    pushLine();
    return lines;
  }

  function layoutFor(content, regular, bold) {
    for (const size of [17, 16, 15, 14, 13]) {
      const mainLines = wrapRuns(content.mainParts, regular, bold, size, 590);
      const recognitionLines = wrapText(content.recognition, regular, size, 590);
      const lineHeight = size * 1.43;
      const mainBottom = 334 - (mainLines.length - 1) * lineHeight;
      const recognitionTop = Math.min(180, mainBottom - 57);
      const recognitionBottom = recognitionTop - (recognitionLines.length - 1) * lineHeight;
      if (recognitionBottom > 125) return {size, lineHeight, mainLines, recognitionLines, recognitionTop};
    }
    throw new Error('O texto do certificado não cabe com legibilidade em uma página A4. Revise os dados cadastrados.');
  }

  function centered(page, value, font, size, y, color = ink, center = W / 2) {
    page.drawText(value, {x: center - font.widthOfTextAtSize(value, size) / 2, y, size, font, color});
  }
  function drawLines(page, lines, font, size, top, lineHeight) {
    lines.forEach((line, index) => centered(page, line, font, size, top - index * lineHeight));
  }
  function drawRichLines(page, lines, regular, bold, size, top, lineHeight) {
    lines.forEach((line, index) => {
      let x = W / 2 - line.width / 2;
      for (const run of line.runs) {
        if (run.advance != null) { x += run.advance; continue; }
        const face = run.bold ? bold : regular;
        page.drawText(run.text, {x, y: top - index * lineHeight, size, font: face, color: ink});
        x += face.widthOfTextAtSize(run.text, size);
      }
    });
  }
  function drawFrame(page) {
    page.drawRectangle({x: 0, y: 0, width: W, height: H, color: PDFLib.rgb(1, 1, 1)});
    const line = (start, end, color, thickness = 0.7) => page.drawLine({start, end, color, thickness});
    line({x: 26, y: 569}, {x: 816, y: 569}, orange, 2);
    line({x: 26, y: 562}, {x: 816, y: 562}, grey, 0.8);
    line({x: 26, y: 31}, {x: 816, y: 31}, grey, 0.8);
    line({x: 26, y: 24}, {x: 816, y: 24}, orange, 2);
  }

  function imageBytes(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        resolve(Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)));
      };
      image.onerror = () => reject(new Error('Não foi possível carregar o logo oficial da SPFLY.'));
      image.src = url;
    });
  }

  async function buildPdf(certificate, logoBytes) {
    const content = certificateContent(certificate);
    const pdf = await PDFLib.PDFDocument.create();
    pdf.setTitle('Certificado de Conclusão - SPFLY Logística');
    pdf.setAuthor('SPFLY Logística');
    const regular = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const titleRegular = await pdf.embedFont(PDFLib.StandardFonts.TimesRoman);
    const titleBold = await pdf.embedFont(PDFLib.StandardFonts.TimesRomanBold);
    const page = pdf.addPage([W, H]);
    const logo = await pdf.embedPng(logoBytes || await imageBytes(new URL('spfly_print_logo.png', assetBase).href));
    const layout = layoutFor(content, regular, bold);
    drawFrame(page);
    page.drawImage(logo, {x: 68, y: 499, width: 144, height: 41});
    centered(page, 'Certificado', titleBold, 47, 427);
    centered(page, 'de conclusão', titleRegular, 22, 398, orange);
    page.drawLine({start: {x: 315, y: 382}, end: {x: 527, y: 382}, color: orange, thickness: 1});
    drawRichLines(page, layout.mainLines, regular, bold, layout.size, 334, layout.lineHeight);
    drawLines(page, layout.recognitionLines, regular, layout.size, layout.recognitionTop, layout.lineHeight);
    page.drawLine({start: {x: 316, y: 105}, end: {x: 526, y: 105}, color: orange, thickness: 1.2});
    centered(page, 'SPFLY LOGÍSTICA', bold, 15, 82);
    centered(page, 'G E S T Ã O   D E   P E S S O A S', regular, 10, 67);
    return pdf.save();
  }

  function filename(certificate) {
    const name = String(certificate.snapshot?.track_name || 'trilha').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    return `SPFLY-certificado-${name}.pdf`;
  }
  async function download(certificate) {
    const blob = new Blob([await buildPdf(certificate)], {type: 'application/pdf'});
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename(certificate);
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function preview(certificate) {
    const tab = window.open('', '_blank');
    if (!tab) throw new Error('Permita a abertura da nova aba para visualizar o certificado.');
    try {
      const blob = new Blob([await buildPdf(certificate)], {type: 'application/pdf'});
      const url = URL.createObjectURL(blob);
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) { tab.close(); throw error; }
  }

  window.SPFLY_OFFICIAL_PDF = {buildPdf, certificateContent, durationLabel, download, preview};
})();
