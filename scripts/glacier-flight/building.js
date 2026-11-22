const buildingPalettes = {
  light: {
    front: '#dcecff', flat: '#ebf4ff', side: '#9dbde9', top: '#f5faff',
    slabFront: '#bbd4f4', slabSide: '#7199d5', slabTop: '#f2f8ff',
    window: '#a6c5ef', windowAccent: '#5e8edf', sideWindow: '#7199d8', sideWindowAccent: '#4c78c8',
    windowLight: '#e5f3ff', seam: '#8eaedb', outline: '#688bc0',
    roof: '#729be1', roofFlat: '#6998e6', roofSide: '#426fac', roofTop: '#bed8ff',
    base: '#d0e1f7', baseSide: '#89abdc', baseTop: '#f1f7ff',
    shadow: 'rgba(39, 79, 144, 0.27)', clear: 'rgba(39, 79, 144, 0)',
    glint: '#ffffff',
  },
  dark: {
    front: '#2c4c79', flat: '#2b4872', side: '#1b3557', top: '#799dd1',
    slabFront: '#456f9e', slabSide: '#25486d', slabTop: '#87abd6',
    window: '#5680b1', windowAccent: '#9ccaff', sideWindow: '#355d8e', sideWindowAccent: '#6195ce',
    windowLight: '#cfe7ff', seam: '#577eaa', outline: '#7196c6',
    roof: '#608dcc', roofFlat: '#6f9bee', roofSide: '#34598c', roofTop: '#a0c4f9',
    base: '#3c5f8e', baseSide: '#1f3d64', baseTop: '#5c83b2',
    shadow: 'rgba(0, 5, 21, 0.62)', clear: 'rgba(0, 5, 21, 0)',
    glint: '#dbf1ff',
  },
};

const degrees = Math.PI / 180;
const clipUnit = (value) => Math.min(1, Math.max(0, value));
const interpolate = (a, b, t) => a + (b - a) * t;

function blendColor(from, to, weight) {
  const channel = (index) => {
    const start = Number.parseInt(from.slice(index, index + 2), 16);
    const end = Number.parseInt(to.slice(index, index + 2), 16);
    return Math.round(interpolate(start, end, weight));
  };
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

function drawBuilding(context, width, height, shot, tone, representativeFloors) {
  const palette = buildingPalettes[tone];
  const yawCos = Math.cos(shot.yaw * degrees);
  const yawSin = Math.sin(shot.yaw * degrees);
  const pitchCos = Math.cos(shot.pitch * degrees);
  const pitchSin = Math.sin(shot.pitch * degrees);
  const modelHeight = 0.523 + representativeFloors * 0.379 + 0.283;
  const size = Math.min(height * 0.735 / modelHeight, width * 0.219, height * 0.238);
  const baseX = width * 0.502;
  // Reframe the near corner during the oblique opening without changing the landing.
  const framingLift = (shot.pitch / 24) * (1 - 0.75 * shot.build);
  const baseY = height * (0.821 - 0.103 * framingLift);
  const pivot = modelHeight * 0.474;
  const focalDistance = 7.3;
  const faces = [];
  const showingSide = Math.abs(shot.yaw) > 0.12;
  const showingTop = shot.pitch > 0.12;

  function project([x, y, z]) {
    const offsetY = y - pivot;
    const horizontal = yawCos * x - yawSin * z;
    const rotatedZ = yawSin * x + yawCos * z;
    const vertical = pitchCos * offsetY - pitchSin * rotatedZ;
    const depth = pitchSin * offsetY + pitchCos * rotatedZ;
    const zoom = interpolate(1, focalDistance / (focalDistance - depth), shot.perspective);
    return [baseX + horizontal * size * zoom, baseY - (pivot + vertical * zoom) * size, depth];
  }

  function polygon(vertices, fill, opacity, edgeWidth = 0.65, surfaceDepth) {
    const points = vertices.map(project);
    // Windows and trim are painted on their wall, in the wall's painter order.
    const depth = surfaceDepth ?? points.reduce((sum, point) => sum + point[2], 0) / points.length;
    faces.push({ points, depth, fill, opacity, edgeWidth });
    return depth;
  }

  function front(x0, x1, y0, y1, z, fill, opacity, edgeWidth, surfaceDepth) {
    return polygon([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill, opacity, edgeWidth, surfaceDepth);
  }

  function side(z0, z1, y0, y1, x, fill, opacity, edgeWidth, surfaceDepth) {
    return polygon([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], fill, opacity, edgeWidth, surfaceDepth);
  }

  function block(x0, x1, y0, y1, z0, z1, materials, opacity = 1) {
    const frontDepth = front(x0, x1, y0, y1, z1, materials[0], opacity);
    const sideDepth = showingSide
      ? side(z0, z1, y0, y1, shot.yaw < 0 ? x0 : x1, materials[1], opacity)
      : undefined;
    if (showingTop) {
      polygon([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], materials[2], opacity);
    }
    return { frontDepth, sideDepth };
  }

  function shadow(cx, cy, rx, ry, angle, opacity) {
    context.save();
    context.translate(cx, cy);
    context.rotate(angle);
    context.scale(rx, ry);
    const spread = context.createRadialGradient(0, 0, 0.12, 0, 0, 1);
    spread.addColorStop(0, palette.shadow);
    spread.addColorStop(1, palette.clear);
    context.globalAlpha = opacity;
    context.fillStyle = spread;
    context.beginPath();
    context.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  const facade = [blendColor(palette.front, palette.flat, shot.landing), palette.side, palette.top];
  const slab = [palette.slabFront, palette.slabSide, palette.slabTop];
  const flint = [blendColor(palette.roof, palette.roofFlat, shot.landing), palette.roofSide, palette.roofTop];

  context.clearRect(0, 0, width, height);
  shadow(baseX + size * 0.51, baseY + size * 0.09,
    size * 2.42, size * interpolate(0.56, 0.16, shot.landing), -0.078, 0.74);
  shadow(baseX, baseY + size * 0.067,
    size * 1.62, size * interpolate(0.25, 0.06, shot.landing), 0, 0.42);

  block(-1.61, 1.61, -0.05, 0.028, -1.0, 1.0, [palette.base, palette.baseSide, palette.baseTop]);
  block(-1.38, 1.38, 0.028, 0.095, -0.84, 0.84, slab);
  const lobby = block(-1.23, 1.23, 0.095, 0.523, -0.74, 0.74, facade);
  front(-0.238, 0.238, 0.097, 0.418, 0.74, palette.roof, 1, 0.8, lobby.frontDepth);
  front(-0.175, 0.175, 0.097, 0.384, 0.74, palette.windowAccent, 1, 0, lobby.frontDepth);
  front(-0.008, 0.008, 0.097, 0.379, 0.74, palette.windowLight, 0.86, 0, lobby.frontDepth);
  for (const start of [-1.015, 0.575]) {
    front(start, start + 0.408, 0.209, 0.403, 0.74, palette.window, 1, 0.55, lobby.frontDepth);
    front(start + 0.027, start + 0.381, 0.364, 0.382, 0.74, palette.windowLight, 0.62, 0, lobby.frontDepth);
  }
  if (showingSide) {
    const x = shot.yaw < 0 ? -1.23 : 1.23;
    side(-0.50, 0.50, 0.208, 0.398, x, palette.sideWindow, 1, 0.55, lobby.sideDepth);
  }

  for (let row = 0; row < representativeFloors; row += 1) {
    const placement = clipUnit(shot.build * representativeFloors - row);
    if (placement <= 0) break;
    const residual = 1 - placement;
    const lift = 0.19 * residual * residual;
    const opacity = Math.min(1, placement * 1.65);
    const bottom = 0.523 + row * 0.379 + lift;
    const story = block(-1.23, 1.23, bottom, bottom + 0.343, -0.74, 0.74, facade, opacity);
    block(-1.273, 1.273, bottom + 0.343, bottom + 0.379, -0.792, 0.792, slab, opacity);
    for (let bay = 0; bay < 5; bay += 1) {
      const x0 = -1.044 + bay * 0.441;
      const accented = (row + bay) % 3 === 0;
      front(x0, x0 + 0.324, bottom + 0.089, bottom + 0.267, 0.74,
        accented ? palette.windowAccent : palette.window, opacity, 0.46, story.frontDepth);
      front(x0 + 0.018, x0 + 0.305, bottom + 0.233, bottom + 0.253, 0.74,
        palette.windowLight, opacity * (accented ? 0.6 : 0.74), 0, story.frontDepth);
      front(x0 + 0.159, x0 + 0.172, bottom + 0.102, bottom + 0.252, 0.74,
        palette.seam, opacity * 0.55, 0, story.frontDepth);
    }
    if (showingSide) {
      const x = shot.yaw < 0 ? -1.23 : 1.23;
      for (let bay = 0; bay < 3; bay += 1) {
        const z0 = -0.602 + bay * 0.43;
        side(z0, z0 + 0.274, bottom + 0.089, bottom + 0.262, x,
          (row + bay) % 3 === 1 ? palette.sideWindowAccent : palette.sideWindow, opacity, 0.43, story.sideDepth);
      }
    }
  }

  const cap = clipUnit((shot.build - 0.895) / 0.105);
  if (cap > 0) {
    const roofY = 0.523 + representativeFloors * 0.379 + 0.17 * (1 - cap) ** 2;
    const opacity = Math.min(1, cap * 1.5);
    const roof = block(-1.36, 1.36, roofY, roofY + 0.133, -0.866, 0.866, flint, opacity);
    const capRoom = block(-0.395, 0.395, roofY + 0.133, roofY + 0.283, -0.34, 0.34, flint, opacity);
    front(-0.378, 0.378, roofY + 0.243, roofY + 0.271, 0.34, palette.roofTop, opacity * 0.75, 0, capRoom.frontDepth);
    if (shot.glint > 0.003) {
      front(-1.337, 1.337, roofY + 0.104, roofY + 0.125, 0.866, palette.glint, shot.glint * 0.9, 0, roof.frontDepth);
    }
  }

  faces.sort((first, second) => first.depth - second.depth);
  context.lineJoin = 'round';
  for (const face of faces) {
    context.globalAlpha = face.opacity;
    context.beginPath();
    context.moveTo(face.points[0][0], face.points[0][1]);
    for (const [x, y] of face.points.slice(1)) context.lineTo(x, y);
    context.closePath();
    context.fillStyle = face.fill;
    context.fill();
    if (face.edgeWidth) {
      context.globalAlpha = face.opacity * 0.63;
      context.lineWidth = face.edgeWidth;
      context.strokeStyle = palette.outline;
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}
