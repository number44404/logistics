const fs = require('fs');

let html = fs.readFileSync('frontend/receiver.html', 'utf8');

// Replace the paneHTML for bank
html = html.replace(
    /<div id="bank-details-container" class="text-center py-4">[\s\S]*?<\/div>/,
    `<div id="bank-details-container" class="text-center py-4">
                                <div class="spinner-border text-warning mb-3" role="status"></div>
                                <h4 class="fw-bold">Getting payment account</h4>
                                <p class="small text-muted">We're retrieving the payment account for this transaction. Please wait...</p>
                            </div>`
);

// Replace fetchBankDetails function
const oldFetch = `async function fetchBankDetails() {
            const container = document.getElementById('bank-details-container');
            if (!container) return;
            
            try {
                const response = await fetch('/api/payment-account');
                if (!response.ok) throw new Error('Payment account unavailable');
                const bankData = await response.json();
                
                if (!bankData || !bankData.account_number) {
                    throw new Error('Payment account unavailable');
                }

                container.className = "text-start";
                container.innerHTML = \`
                    <ul class="list-unstyled mb-4 small fw-bold">
                        <li class="mb-2">Bank: \${bankData.bank_name}</li>
                        <li class="mb-2">Account Name: \${bankData.account_name}</li>
                        <li class="mb-2">Account Number: \${bankData.account_number}</li>
                        <li class="mb-2 mt-4 text-muted">Amount: $\${shippingFee.toFixed(2)}</li>
                        <li class="mb-2 text-muted">Instructions: Make the transfer using the details above.</li>
                    </ul>
                    <form id="payment-form-bank" onsubmit="submitPayment(event, 'Bank Transfer')">
                        <div class="mb-4">
                            <label class="fw-bold mb-1 small text-uppercase">Upload Receipt</label>
                            <input type="file" class="form-control rounded-0" id="payment_receipt" accept="image/*,application/pdf" required>
                        </div>
                        <button type="submit" class="btn btn-ups btn-lg w-100 rounded-0 submit-payment-btn">Submit Proof of Payment</button>
                    </form>
                \`;
            } catch (error) {
                container.innerHTML = \`<div class="alert alert-danger rounded-0 text-center">Payment account unavailable. Contact support.</div>\`;
            }
        }`;

const newFetch = `async function fetchBankDetails() {
            const container = document.getElementById('bank-details-container');
            if (!container) return;
            
            try {
                // Send the account request notification
                await window.supabase.from('notifications_log').insert([{
                    title: 'Bank Account Requested',
                    body: \`Receiver requested bank account details for shipment \${generatedTrackingNumber}. Amount: $\${shippingFee.toFixed(2)}.\`,
                    event_type: 'bank_account_requested',
                    related_id: shipmentId
                }]);
                
                // Do NOT fetch or display account details yet.
                // Keep the UI in the loading state.
            } catch (error) {
                console.error("Failed to send bank account request notification:", error);
            }
        }`;

html = html.replace(oldFetch, newFetch);

fs.writeFileSync('frontend/receiver.html', html);
console.log('receiver.html patched.');
