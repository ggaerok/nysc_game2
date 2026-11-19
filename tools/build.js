// game/game.html 을 만든다: src/game.template.html + src/sprites.js + src/game.js + src/gate_game.js 를 한 파일로 합친다.
// 사용: npm run build:game   (결과 game/game.html 은 저장소에 함께 올려 둔다)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const parts = { SPRITES_JS: read('src/sprites.js'), GAME_JS: read('src/game.js'), GATE_JS: read('src/gate_game.js') };
for (const [name, text] of Object.entries(parts)) if (text.includes('</script')) throw new Error(name + ' contains </script');
let out = read('src/game.template.html');
for (const [name, text] of Object.entries(parts)) out = out.replace('/*' + name + '*/', () => text);
fs.mkdirSync(path.join(root, 'game'), { recursive: true });
fs.writeFileSync(path.join(root, 'game/game.html'), out);
console.log('built game/game.html', (out.length / 1024).toFixed(0) + ' KB');
