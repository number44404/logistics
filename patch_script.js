const fs = require('fs');

let content = fs.readFileSync('frontend/script.js', 'utf8');

const replacement = `    function renderShipment(shipment) {
        window.currentShipmentData = shipment;
        
        const downloadReceiptBtn = document.getElementById("download-receipt-btn");
        if (downloadReceiptBtn) {
            if (shipment.payment_status === 'paid') {
                downloadReceiptBtn.style.display = 'inline-block';
            } else {
                downloadReceiptBtn.style.display = 'none';
            }
        }`;

content = content.replace('    function renderShipment(shipment) {\n        window.currentShipmentData = shipment;', replacement);
fs.writeFileSync('frontend/script.js', content);
