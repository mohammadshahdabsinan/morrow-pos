const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wwwDir = path.join(root, 'www');
const files = ['index.html', 'app.js', 'styles.css', 'config.js'];

fs.mkdirSync(wwwDir, { recursive: true });

for (const file of files) {
  const src = path.join(root, file);
  const dest = path.join(wwwDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} -> www/${file}`);
  } else {
    console.warn(`Skipped ${file} (not found)`);
  }
}
