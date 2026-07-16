import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

async function test() {
  const dataBuffer = fs.readFileSync('d:/College_Work/medical-report-analyzer/data/samples/shivek_June25.pdf');
  
  function render_page(pageData) {
    return pageData.getTextContent()
    .then(function(textContent) {
        // Just print the first 20 items to see the structure
        console.log("Page", pageData.pageIndex);
        if (pageData.pageIndex === 1) {
            console.log(textContent.items.slice(0, 20).map(item => ({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
                height: item.height
            })));
        }
        return '';
    });
  }

  const options = {
      pagerender: render_page
  }

  await pdfParse(dataBuffer, options);
}

test().catch(console.error);
