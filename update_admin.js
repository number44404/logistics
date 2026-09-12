const fs = require('fs');

let content = fs.readFileSync('frontend/admin.html', 'utf8');

const regex = /const receiptHTML = `[\\s\\S]*?`;/;

const newTemplate = `const receiptHTML = \`
            <html>
            <head>
                <title>Shipment Receipt - \${data.tracking_number}</title>
                <style>
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #000; max-width: 800px; margin: 0 auto; font-size: 13px; line-height: 1.4; }
                    .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 30px; }
                    .logo-title { display: flex; align-items: center; gap: 15px; }
                    .title { font-size: 18px; font-weight: normal; }
                    .header-date, .header-tracking { font-size: 14px; }
                    .section { margin-bottom: 20px; }
                    .section-title { font-size: 16px; font-weight: 500; margin-bottom: 8px; }
                    .divider { border-bottom: 1px solid #ddd; margin-bottom: 15px; }
                    .yellow-divider { border-bottom: 2px solid #ffb500; margin-top: 5px; margin-bottom: 15px; }
                    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
                    .col-title { font-weight: 600; margin-bottom: 5px; }
                    .info-text { margin-bottom: 3px; }
                    .info-text.upper { text-transform: uppercase; }
                    .parcel-title { font-weight: 600; margin: 20px 0 10px 0; }
                    .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px; }
                    .grid-label { font-weight: normal; margin-bottom: 2px; }
                    .grid-val { font-size: 13px; }
                    .table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
                    .table td { padding: 8px 0; border-bottom: 1px solid #ddd; }
                    .table .right { text-align: right; }
                    .table.no-border td { border-bottom: none; padding: 4px 0; }
                    .table.bold-top td { border-top: 1px solid #000; font-weight: 600; }
                    .legal-text { font-size: 10px; color: #333; margin-top: 30px; text-align: justify; }
                    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } button { display: none; } }
                    .print-btn { background: #ffb500; color: #000; border: none; padding: 10px 20px; font-weight: bold; cursor: pointer; border-radius: 20px; float: right; }
                    .clear { clear: both; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
                <div class="clear"></div>
                <div class="header">
                    <div class="logo-title">
                        <svg viewBox="0 0 40 46" height="35" width="35" xmlns="http://www.w3.org/2000/svg">
                            <path fill="#ffb500" d="M29.5 0h-19C4.7 0 0 4.7 0 10.5v25C0 41.3 4.7 46 10.5 46h19c5.8 0 10.5-4.7 10.5-10.5v-25C40 4.7 35.3 0 29.5 0z"/>
                            <path fill="#3a2618" d="M30 6H10C7.8 6 6 7.8 6 10v26c0 2.2 1.8 4 4 4h20c2.2 0 4-1.8 4-4V10c0-2.2-1.8-4-4-4zm-2.8 28.5L20 30l-7.2 4.5v-18l7.2-4.5 7.2 4.5v18z"/>
                        </svg>
                        <div class="title">Shipment Receipt</div>
                    </div>
                    <div class="header-date">\${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                    <div class="header-tracking">\${data.tracking_number}</div>
                </div>
                
                <div class="section">
                    <div class="section-title">Where</div>
                    <div class="divider"></div>
                    <div class="grid-2">
                        <div>
                            <div class="col-title">Ship From</div>
                            <div class="info-text upper">\${data.sender ? data.sender.full_name : 'N/A'}</div>
                            <div class="info-text upper">\${data.sender ? data.sender.address + '<br>' + data.sender.city + ', ' + data.sender.country : 'N/A'}</div>
                        </div>
                        <div>
                            <div class="col-title">Ship To</div>
                            <div class="info-text upper">\${data.receiver ? data.receiver.full_name : 'PENDING (DRAFT)'}</div>
                            <div class="info-text upper">\${data.receiver ? data.receiver.address + '<br>' + data.receiver.city + ', ' + data.receiver.country : 'N/A'}</div>
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <div class="section-title">What</div>
                    <div class="divider"></div>
                    <div class="info-text">Total Shipment Weight: \${data.package && data.package.weight ? data.package.weight + ' KGS' : 'N/A'}</div>
                    
                    <div class="parcel-title">Parcel 1 - \${data.tracking_number}</div>
                    <div class="grid-4">
                        <div>
                            <div class="grid-label">Weight</div>
                            <div class="grid-val">\${data.package && data.package.weight ? data.package.weight + ' KGS' : 'N/A'}</div>
                        </div>
                        <div>
                            <div class="grid-label">Dimensions</div>
                            <div class="grid-val">\${data.package && data.package.length ? data.package.length + 'x' + data.package.width + 'x' + data.package.height + ' cm' : 'My Packaging'}</div>
                        </div>
                    </div>
                    
                    <div class="section-title" style="margin-top:20px;">Service Details - \${data.shipping_method || 'UPS Worldwide Expedited'}</div>
                    <div class="yellow-divider"></div>
                    <div class="info-text" style="font-weight: 600;">Estimated Delivery: \${data.estimated_delivery || 'Pending'}</div>
                </div>

                <div class="section">
                    <div class="section-title">Payment</div>
                    <div class="divider"></div>
                    <div class="info-text">Bill Shipping Charges To: Shipper</div>
                    <div class="info-text">Bill Duties and Taxes To: Receiver</div>
                </div>

                <div class="section">
                    <div class="section-title">Shipping Total</div>
                    <div class="divider"></div>
                    <div class="grid-2">
                        <div>
                            <div class="col-title">Shipping Fees</div>
                            <table class="table no-border">
                                <tr><td>\${data.shipping_method || 'UPS Worldwide Expedited'}</td><td class="right">\${data.shipping_fee ? '$' + parseFloat(data.shipping_fee).toFixed(2) : '$0.00'}</td></tr>
                                <tr class="bold-top"><td>Transportation Charges</td><td class="right"></td></tr>
                            </table>
                        </div>
                        <div>
                            <div class="col-title">Subtotals</div>
                            <table class="table no-border">
                                <tr><td>Shipping Fees</td><td class="right">\${data.shipping_fee ? '$' + parseFloat(data.shipping_fee).toFixed(2) : '$0.00'}</td></tr>
                                <tr class="bold-top"><td>Combined Charges</td><td class="right">\${data.shipping_fee ? '$' + parseFloat(data.shipping_fee).toFixed(2) : '$0.00'}</td></tr>
                            </table>
                        </div>
                    </div>
                    <div class="legal-text" style="margin-top: 10px; font-size:11px;">The rate excludes VAT. Rate includes a fuel surcharge, but excludes taxes, duties and other charges that may apply to the shipment.</div>
                </div>
                
                <div class="legal-text">
                    Note This document is not an invoice.<br><br>
                    All shipments are subject to the UPS Terms and Conditions of Service for the country of origin in effect at the time of shipping which can be found at www.ups.com ('UPS Terms'). Unless governed by the Convention for the Unification of Certain Rules Relating to International Transportation by Air signed at Warsaw, Poland, on 12 October 1929, and any amendments thereto ('Warsaw Convention'), the Convention on the Contract for the International Carriage of Goods by Road ('CMR Convention'), or other mandatory law, UPS's liability for damage or loss of this shipment is limited to a maximum of US$100 (or local currency equivalent) per shipment or as otherwise limited by the UPS Terms. No protection for loss or damage of this shipment in excess of the amount pursuant to the previous sentence is provided unless the shipper declares a higher value for carriage and pays an additional charge. If the shipper declares a higher value for carriage and pays the additional applicable charge, then UPS's liability shall be limited to proven damages of not more than the sum so declared. Claims not made within the time limits set forth in the applicable UPS Terms shall be deemed waived. UPS shall not be liable for any special, incidental, or consequential damages.
                </div>
                
                <script>setTimeout(() => { window.print(); }, 500);<\\/script>
            </body>
            </html>
        \`;`;

content = content.replace(regex, newTemplate);
fs.writeFileSync('frontend/admin.html', content);
