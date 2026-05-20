const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
    const htmlFile = `file:///${path.resolve(__dirname, 'carrusel-premium.html').replace(/\\/g, '/')}`;
    const outputDir = path.resolve(__dirname, 'redes sociales');
    
    if (!fs.existsSync(outputDir)){
        fs.mkdirSync(outputDir);
    }

    console.log('Launching browser...');
    // We launch it in headless mode
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    console.log(`Navigating to ${htmlFile}...`);
    await page.goto(htmlFile, {waitUntil: 'networkidle0'});

    // Disable scale, padding, and controls so the slides render at exactly 1080x1350 natively
    await page.evaluate(() => {
        const wrapper = document.querySelector('.carousel-wrapper');
        if(wrapper) {
            wrapper.style.transform = 'none';
            wrapper.style.margin = '0';
        }
        document.body.style.padding = '0';
        const controls = document.querySelector('.controls');
        if(controls) {
            controls.style.display = 'none';
        }
    });

    // Set viewport to the full width of the 6 slides
    await page.setViewport({ width: 1080 * 6, height: 1350, deviceScaleFactor: 1 });

    const slidesNum = 6;
    for (let i = 0; i < slidesNum; i++) {
        console.log(`Capturing slide ${i + 1}...`);
        await page.screenshot({
            path: path.join(outputDir, `slide_${i + 1}.png`),
            clip: {
                x: i * 1080,
                y: 0,
                width: 1080,
                height: 1350
            }
        });
    }

    console.log('Done!');
    await browser.close();
})();
