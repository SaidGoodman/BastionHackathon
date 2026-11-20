/** Стили элементов — скопированы из 06_template.drawio и образцов 05_pattern_F02/F07. */
/** Formular недоступен публично — используем Open Sans; fontSource подгружает его в draw.io и просмотрщике. */
export const FONT = 'Open Sans;fontSource=https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DOpen%2BSans';
export const BG = '#303E48';
export const RULE_COLORS = ['#E06733', '#35C4AF', '#FFAB4D', '#B9C5CD', '#6FA8DC'];

export const S = {
  title: `text;html=1;align=left;verticalAlign=middle;fontColor=#FFFFFF;fontSize=20;fontStyle=1;fontFamily=${FONT};`,
  subtitle: `text;html=1;align=left;verticalAlign=middle;fontColor=#B9C5CD;fontSize=12;fontFamily=${FONT};`,
  status: `rounded=1;arcSize=50;fillColor=#FFAB4D;strokeColor=none;html=1;fontColor=#303E48;fontSize=11;fontStyle=1;fontFamily=${FONT};`,
  segment: (color: string) =>
    `rounded=1;arcSize=5;dashed=1;dashPattern=8 6;fillColor=none;strokeColor=${color};strokeWidth=2;html=1;align=left;verticalAlign=top;spacingLeft=14;spacingTop=6;fontColor=${color};fontSize=12;fontFamily=${FONT};`,
  card: `rounded=1;arcSize=14;fillColor=#4A5D6A;strokeColor=none;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;spacingLeft=14;spacingRight=8;fontColor=#FFFFFF;fontSize=13;fontFamily=${FONT};`,
  placeholderCard: `rounded=1;arcSize=14;fillColor=#4A5D6A;strokeColor=#B9C5CD;dashed=1;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;spacingLeft=14;spacingRight=8;fontColor=#FFFFFF;fontSize=13;fontFamily=${FONT};`,
  firewall: (image: string) =>
    `shape=image;imageAspect=0;aspect=fixed;html=1;image=${image};verticalLabelPosition=top;verticalAlign=bottom;labelPosition=center;align=center;fontColor=#FFAB4D;fontSize=13;fontStyle=1;fontFamily=${FONT};`,
  sxLabel: `text;html=1;align=center;verticalAlign=middle;fontColor=#E06733;fontSize=13;fontStyle=1;fontFamily=${FONT};`,
  sxBox: 'rounded=1;arcSize=10;fillColor=#FFFFFF;strokeColor=#E06733;strokeWidth=2;html=1;',
  node: `rounded=1;arcSize=12;fillColor=#F2F4F6;strokeColor=#B9C5CD;html=1;fontColor=#3A4D59;fontSize=10;fontStyle=1;fontFamily=${FONT};`,
  core: `shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=14;fillColor=#F2F4F6;strokeColor=#B9C5CD;html=1;fontColor=#3A4D59;fontSize=10;fontStyle=1;fontFamily=${FONT};`,
  usb: `rounded=1;arcSize=30;fillColor=#354552;strokeColor=#B9C5CD;html=1;fontColor=#FFFFFF;fontSize=11;fontStyle=1;fontFamily=${FONT};`,
  pill: `rounded=1;arcSize=50;fillColor=#354552;strokeColor=none;html=1;fontColor=#FFFFFF;fontSize=10;fontStyle=1;fontFamily=${FONT};`,
  edge: (color: string, start: boolean, end: boolean, exit: [number, number], entry: [number, number]) =>
    `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=${color};strokeWidth=2;` +
    `endArrow=${end ? 'block' : 'none'};endFill=1;startArrow=${start ? 'block' : 'none'};startFill=1;` +
    `exitX=${exit[0]};exitY=${exit[1]};exitDx=0;exitDy=0;entryX=${entry[0]};entryY=${entry[1]};entryDx=0;entryDy=0;`,
  legendHead: `text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;fontColor=#FFFFFF;fontSize=13;fontStyle=1;fontFamily=${FONT};`,
  legendMark: (color: string) => `rounded=1;arcSize=30;fillColor=${color};strokeColor=none;`,
  legendLine: `text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;fontColor=#FFFFFF;fontSize=11;fontFamily=${FONT};`,
  legendNote: `text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;fontColor=#B9C5CD;fontSize=11;fontFamily=${FONT};`,
};
