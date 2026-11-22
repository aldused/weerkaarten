import {composePNG} from './ecmwf_weerradar/png-export.mjs';

const svgProperties = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'paint-order', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'visibility', 'vector-effect',
];

export async function svgMapImage(svg) {
  const copy = svg.cloneNode(true);
  const {width, height} = svg.viewBox.baseVal;
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = Math.round(canvas.width * height / width);
  copy.setAttribute('width', canvas.width);
  copy.setAttribute('height', canvas.height);
  const elements = [...svg.querySelectorAll('*')];
  copy.querySelectorAll('*').forEach((element, index) => {
    const style = getComputedStyle(elements[index]);
    for (const property of svgProperties) {
      const value = style.getPropertyValue(property);
      if (value) element.style.setProperty(property, value.replace(/url\(["']?[^#)]+#([^"')]+)["']?\)/g, 'url(#$1)'));
    }
  });
  copy.querySelector('#gFocus')?.remove();
  const source = new XMLSerializer().serializeToString(copy);
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
  await image.decode();
  const context = canvas.getContext('2d');
  context.fillStyle = getComputedStyle(svg).getPropertyValue('--sea').trim() || '#dfeaf5';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas;
}

export async function saveMapPNG(map, details, filename) {
  const canvas = composePNG(map, details);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG kon niet worden gemaakt');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
