const fs = require('fs');

let content = fs.readFileSync('frontend/admin.html', 'utf8');

const regex = /if \(s\.payment_status === 'pending_verification'\) {/;

const newStr = `
            if (s.payment_status === 'paid') {
                actionBtns = \`<button class="btn btn-sm btn-success rounded-0 px-2 ms-1" onclick="downloadAdminReceiptFromDashboard('\${s.tracking_number}')">Invoice/Receipt</button>\` + actionBtns;
            }

            if (s.payment_status === 'pending_verification') {`;

content = content.replace(regex, newStr);

// Now for mobile layout in the same file
const regexMobile = /\${s\.payment_status === 'pending_verification' \? \`<button class="btn btn-warning" style="min-height: 48px; border-radius: 24px; font-weight: bold;" onclick="approvePayment\('\${s\.id}'\)"><span class="material-symbols-rounded align-middle">receipt_long<\/span><\/button>\` : ''}/;

const newMobileStr = `\${s.payment_status === 'pending_verification' ? \`<button class="btn btn-warning" style="min-height: 48px; border-radius: 24px; font-weight: bold;" onclick="approvePayment('\${s.id}')"><span class="material-symbols-rounded align-middle">receipt_long</span></button>\` : ''}
                    \${s.payment_status === 'paid' ? \`<button class="btn btn-success" style="min-height: 48px; border-radius: 24px; font-weight: bold; margin-left: 5px;" onclick="downloadAdminReceiptFromDashboard('\${s.tracking_number}')"><span class="material-symbols-rounded align-middle">download</span></button>\` : ''}`;

content = content.replace(regexMobile, newMobileStr);

fs.writeFileSync('frontend/admin.html', content);
