const fs = require('fs');

let adminContent = fs.readFileSync('frontend/admin.html', 'utf8');
adminContent = adminContent.replace(/<button class="btn btn-outline-ups btn-lg rounded-0 fw-bold px-4" onclick="downloadAdminReceipt\(\)">[\s\S]*?<\/button>/, '');
fs.writeFileSync('frontend/admin.html', adminContent);

let receiverContent = fs.readFileSync('frontend/receiver.html', 'utf8');
receiverContent = receiverContent.replace(/<button class="btn btn-outline-ups fw-bold px-4 mx-auto" style="width: fit-content;" onclick="downloadReceiverReceipt\(\)">[\s\S]*?<\/button>/, '');
fs.writeFileSync('frontend/receiver.html', receiverContent);
