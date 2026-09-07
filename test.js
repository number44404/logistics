    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="supabase-config.js"></script>
    <script>
        let shipmentId = null;
        let token = null;
        let shippingFee = 0;
        let generatedTrackingNumber = null;
        let globalShipment = null;
        let receiverId = null;

        document.addEventListener('DOMContentLoaded', async () => {
            const urlParams = new URLSearchParams(window.location.search);
            token = urlParams.get('token');

            if (!token) {
                showError("Missing Link", "No secure token was found in the URL.");
                return;
            }

            try {
                // Fetch link data
                const { data: linkData, error: linkError } = await window.supabase
                    .from('receiver_links')
                    .select('*, shipments(*, senders(full_name, city, country), packages(*))')
                    .eq('secure_token', token)
                    .single();

                if (linkError) throw linkError;

                if (linkData.status === 'completed') {
                    showError("Link Expired", "This receiver link has already been completed.");
                    return;
                }
                
                const shipment = linkData.shipments;
                globalShipment = shipment;

                // Show form
                shipmentId = shipment.id;
                shippingFee = shipment.shipping_fee || 0;
                document.getElementById('sender-name').textContent = shipment.senders?.full_name || 'the sender';
                
                document.getElementById('loading').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                document.getElementById('form-state').classList.remove('d-none');
                
            } catch (err) {
                showError("System Error", "An unexpected error occurred. Please try again later.");
            }
        });

        document.getElementById('receiver-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = 'Processing...';

            const receiverData = {
                full_name: document.getElementById('full_name').value,
                email: document.getElementById('email').value,
                phone: document.getElementById('phone').value,
                address: document.getElementById('address').value,
                city: document.getElementById('city').value,
                country: document.getElementById('country').value,
                postal_code: document.getElementById('postal_code').value
            };

            try {
                // 1. Insert Receiver
                const { data: receiver, error: receiverError } = await window.supabase
                    .from('receivers')
                    .insert([receiverData])
                    .select().single();
                if (receiverError) throw receiverError;
                receiverId = receiver.id;

                // 2. Generate Tracking Number
                const trackingNumber = await generateTrackingNumber(receiverData.country.substring(0, 2));

                // 3. Update Shipment
                const { error: shipmentError } = await window.supabase
                    .from('shipments')
                    .update({
                        receiver_id: receiver.id,
                        is_draft: false,
                        tracking_number: trackingNumber,
                        status: 'Pending'
                    })
                    .eq('id', shipmentId);
                
                if (shipmentError) throw shipmentError;

                // 3.5. Update Link Status
                await window.supabase
                    .from('receiver_links')
                    .update({ status: 'completed' })
                    .eq('secure_token', token);

                // 4. Log initial tracking event
                await window.supabase.from('tracking_events').insert([{
                    shipment_id: shipmentId,
                    status: 'Pending',
                    location: receiverData.city,
                    description: "Shipment created after receiver provided address."
                }]);

                // Log notification
                await window.supabase.from('notifications_log').insert([{
                    title: "Receiver Completed Details",
                    body: `The receiver provided their delivery address for shipment ${trackingNumber}.`,
                    event_type: "address_completed",
                    related_id: shipmentId
                }]);

                // Transition to Payment State
                generatedTrackingNumber = trackingNumber;
                document.getElementById('form-state').classList.add('d-none');
                
                if (shippingFee > 0) {
                    // Populate Summaries
                    const s_origin = `${globalShipment.senders?.city || ''}, ${globalShipment.senders?.country || ''}`;
                    document.getElementById('summary-origin').textContent = s_origin;
                    document.getElementById('summary-delivery').textContent = globalShipment.estimated_delivery || 'TBD';
                    
                    const p = globalShipment.packages;
                    document.getElementById('summary-weight').textContent = p ? `${p.weight} lbs` : 'N/A';
                    document.getElementById('summary-dims').textContent = p ? `${p.length}x${p.width}x${p.height} in` : 'N/A';
                    document.getElementById('summary-value').textContent = p ? `$${p.declared_value}` : 'N/A';
                    
                    document.getElementById('summary-address').innerHTML = `${receiverData.full_name}<br>${receiverData.address}<br>${receiverData.city}, ${receiverData.country} ${receiverData.postal_code}`;

                    document.getElementById('display-shipping-fee').textContent = shippingFee.toFixed(2);
                    await loadPaymentMethods();
                    document.getElementById('payment-state').classList.remove('d-none');
                } else {
                    // Free shipping, skip payment
                    document.getElementById('success-state').classList.remove('d-none');
                    document.getElementById('final-tracking-number').textContent = trackingNumber;
                }

            } catch (err) {
                document.getElementById('form-error').textContent = err.message || "An error occurred.";
                document.getElementById('form-error').classList.remove('d-none');
                btn.disabled = false;
                btn.textContent = 'Confirm Address';
            }
        });

        window.submitPayment = async (e, method) => {
            e.preventDefault();
            const btn = e.target.querySelector('.submit-payment-btn');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Processing...';
            const errorBox = document.getElementById('payment-error');
            errorBox.classList.add('d-none');

            try {
                let receiptUrl = null;
                let paymentDetails = null;

                if (method === 'Bank Transfer') {
                    const fileInput = document.getElementById('payment_receipt');
                    if (fileInput.files.length === 0) throw new Error("Please upload a receipt.");
                    const file = fileInput.files[0];
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${shipmentId}_${Date.now()}.${fileExt}`;
                    
                    const { data: uploadData, error: uploadError } = await window.supabase
                        .storage.from('receipts').upload(fileName, file, { cacheControl: '3600', upsert: false });
                    if (uploadError) throw uploadError;
                    
                    const { data: publicUrlData } = window.supabase.storage.from('receipts').getPublicUrl(fileName);
                    receiptUrl = publicUrlData.publicUrl;
                } else if (method === 'Gift Card') {
                    const code = document.getElementById('gift_card_code').value;
                    paymentDetails = `Gift Card Code: ${code}`;
                } else if (method === 'Credit Card') {
                    paymentDetails = `Card Payment Submitted`;
                }

                // Update Shipment
                // 1. Insert into Payments Table
                const { error: paymentError } = await window.supabase
                    .from('payments')
                    .insert([{
                        shipment_id: shipmentId,
                        receiver_id: receiverId,
                        payment_method: method,
                        payment_details: paymentDetails,
                        receipt_url: receiptUrl,
                        amount: shippingFee,
                        status: 'pending_verification'
                    }]);
                if (paymentError) throw paymentError;

                // 2. Update Shipment (Legacy support)
                const { error: shipmentError } = await window.supabase
                    .from('shipments')
                    .update({
                        payment_method: method,
                        payment_receipt_url: receiptUrl,
                        payment_details: paymentDetails,
                        payment_status: 'pending_verification'
                    })
                    .eq('id', shipmentId);
                
                if (shipmentError) throw shipmentError;

                // Log notification
                await window.supabase.from('notifications_log').insert([{
                    title: "New Payment Request",
                    body: `A new ${method} payment of $${shippingFee.toFixed(2)} is pending verification for shipment ${generatedTrackingNumber}.`,
                    event_type: "payment_submitted",
                    related_id: shipmentId
                }]);

                // Show Success
                document.getElementById('payment-state').classList.add('d-none');
                document.getElementById('success-state').classList.remove('d-none');
                document.getElementById('final-tracking-number').textContent = generatedTrackingNumber;

            } catch (err) {
                errorBox.textContent = err.message || "An error occurred processing your payment.";
                errorBox.classList.remove('d-none');
                btn.disabled = false;
                btn.textContent = originalText;
            }
        };

        async function loadPaymentMethods() {
            const tabsContainer = document.getElementById('paymentTabs');
            const contentContainer = document.getElementById('paymentTabsContent');
            tabsContainer.innerHTML = '';
            contentContainer.innerHTML = '';

            try {
                const { data: methods, error } = await window.supabase
                    .from('payment_methods')
                    .select('*')
                    .eq('is_active', true)
                    .order('created_at', { ascending: true });

                if (error) throw error;
                if (!methods || methods.length === 0) {
                    contentContainer.innerHTML = '<p class="text-danger">No payment methods are currently available. Please contact support.</p>';
                    return;
                }

                let isFirst = true;

                for (const method of methods) {
                    const tabId = `${method.type}-tab`;
                    const paneId = `${method.type}-pane`;

                    // Generate Tab
                    const li = document.createElement('li');
                    li.className = 'nav-item';
                    li.setAttribute('role', 'presentation');
                    let icon = 'payments';
                    if (method.type === 'bank') icon = 'account_balance';
                    if (method.type === 'card') icon = 'credit_card';
                    if (method.type === 'gift_card') icon = 'card_giftcard';

                    li.innerHTML = `
                        <button class="nav-link fw-bold text-dark w-100 ${isFirst ? 'active' : ''}" id="${tabId}" data-bs-toggle="tab" data-bs-target="#${paneId}" type="button" role="tab">
                            <span class="material-symbols-rounded d-block mb-1" style="font-size:2rem; color:var(--ups-brown)">${icon}</span>
                            ${method.name}
                        </button>
                    `;
                    tabsContainer.appendChild(li);

                    // Generate Content Pane
                    const pane = document.createElement('div');
                    pane.className = `tab-pane fade ${isFirst ? 'show active' : ''}`;
                    pane.id = paneId;
                    pane.setAttribute('role', 'tabpanel');

                    let paneHTML = `<p class="small text-muted mb-4">${method.instructions || ''}</p>`;

                    if (method.type === 'bank') {
                        // Fetch active bank account
                        const { data: bankData } = await window.supabase.from('bank_accounts').select('*').eq('is_active', true).limit(1).single();
                        if (bankData) {
                            paneHTML += `
                                <ul class="list-unstyled mb-4 small fw-bold">
                                    <li class="mb-2">Bank Name: ${bankData.bank_name}</li>
                                    <li class="mb-2">Account Name: ${bankData.account_name}</li>
                                    <li class="mb-2">Account Number: ${bankData.account_number}</li>
                                    ${bankData.routing_number ? `<li>Routing Number: ${bankData.routing_number}</li>` : ''}
                                </ul>
                            `;
                        }
                        paneHTML += `
                            <form id="payment-form-bank" onsubmit="submitPayment(event, '${method.name}')">
                                <div class="mb-4">
                                    <label class="fw-bold mb-1 small text-uppercase">Upload Receipt</label>
                                    <input type="file" class="form-control rounded-0" id="payment_receipt" accept="image/*,application/pdf" required>
                                </div>
                                <button type="submit" class="btn btn-ups btn-lg w-100 rounded-0 submit-payment-btn">Submit Proof of Payment</button>
                            </form>
                        `;
                    } else if (method.type === 'card') {
                        paneHTML += `
                            <form id="payment-form-card" onsubmit="submitPayment(event, '${method.name}')">
                                <div class="mb-3">
                                    <label class="fw-bold mb-1 small text-uppercase">Card Number</label>
                                    <input type="text" class="form-control rounded-0" placeholder="0000 0000 0000 0000" required>
                                </div>
                                <div class="row g-2 mb-4">
                                    <div class="col-6">
                                        <label class="fw-bold mb-1 small text-uppercase">Expiry</label>
                                        <input type="text" class="form-control rounded-0" placeholder="MM/YY" required>
                                    </div>
                                    <div class="col-6">
                                        <label class="fw-bold mb-1 small text-uppercase">CVC</label>
                                        <input type="text" class="form-control rounded-0" placeholder="123" required>
                                    </div>
                                </div>
                                <button type="submit" class="btn btn-ups btn-lg w-100 rounded-0 submit-payment-btn">Pay Now</button>
                            </form>
                        `;
                    } else if (method.type === 'gift_card') {
                        paneHTML += `
                            <form id="payment-form-giftcard" onsubmit="submitPayment(event, '${method.name}')">
                                <div class="mb-4">
                                    <label class="fw-bold mb-1 small text-uppercase">Gift Card Code</label>
                                    <input type="text" class="form-control rounded-0" id="gift_card_code" placeholder="XXXX-XXXX-XXXX" required>
                                </div>
                                <button type="submit" class="btn btn-ups btn-lg w-100 rounded-0 submit-payment-btn">Redeem & Pay</button>
                            </form>
                        `;
                    }

                    pane.innerHTML = paneHTML;
                    contentContainer.appendChild(pane);

                    isFirst = false;
                }
            } catch (err) {
                console.error("Error loading payment methods:", err);
            }
        }

        function showError(title, msg) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            document.getElementById('error-title').textContent = title;
            document.getElementById('error-msg').textContent = msg;
            document.getElementById('error-state').classList.remove('d-none');
        }

        async function generateTrackingNumber(countryCode = 'XX') {
            let isUnique = false;
            let newTracking = '';
            while (!isUnique) {
                const today = new Date();
                const dateStr = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
                
                let randomStr = '';
                if (window.crypto && window.crypto.getRandomValues) {
                    const array = new Uint32Array(1);
                    window.crypto.getRandomValues(array);
                    randomStr = array[0].toString(36).substring(0, 6).toUpperCase().padStart(6, '0');
                } else {
                    randomStr = Math.random().toString(36).substring(2, 8).toUpperCase().padStart(6, '0');
                }
                
                newTracking = `TRK-${countryCode.toUpperCase()}-${dateStr}-${randomStr}`;

                const { data, error } = await window.supabase
                    .from('shipments')
                    .select('id')
                    .eq('tracking_number', newTracking)
                    .single();

                if (error && error.code === 'PGRST116') {
                    isUnique = true;
                } else if (!data) {
                    isUnique = true;
                }
            }
            return newTracking;
        }
    </script>
</body>
</html>
