
document.addEventListener("DOMContentLoaded", () => {
    const homeTrackBtn = document.getElementById("home-track-btn");
    const searchViewContainer = homeTrackBtn ? homeTrackBtn.closest(".card").parentElement : null;
    const resultView = document.getElementById("result-view");
    const backToResultsBtn = document.getElementById("back-to-results");
    
    // Elements from track.html
    const claimAlert = document.getElementById("claim-alert");
    const detailsModal = document.getElementById("details-modal");
    const proofModal = document.getElementById("proof-modal");
    const viewDetailsBtn = document.getElementById("view-details-btn");
    const proofBtn = document.getElementById("proof-btn");
    const proofContainer = document.getElementById("proof-container");
    const changeDeliveryBtn = document.getElementById("change-delivery-btn");
    const downloadReceiptBtn = document.getElementById("download-receipt-btn");
    
    // Tabs
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");

    // Close Modals
    document.querySelectorAll(".close-modal, .close-modal-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const modalId = e.target.getAttribute("data-modal") || e.target.closest(".custom-modal-backdrop").id;
            document.getElementById(modalId).style.display = "none";
        });
    });

    // Open Details Modal
    if(viewDetailsBtn) {
        viewDetailsBtn.addEventListener("click", () => {
            detailsModal.style.display = "flex";
        });
    }

    // Open Proof Modal
    if(proofBtn) {
        proofBtn.addEventListener("click", () => {
            proofModal.style.display = "flex";
        });
    }

    // Tab Switching
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            tabPanes.forEach(p => p.style.display = "none");
            
            btn.classList.add("active");
            const target = btn.getAttribute("data-target");
            document.getElementById(target).style.display = "block";
        });
    });

    if (homeTrackBtn) {
        homeTrackBtn.addEventListener("click", async () => {
            const desktopInput = document.getElementById("home-track-desktop");
            const mobileInput = document.getElementById("home-track-mobile");
            
            let trackingId = desktopInput && desktopInput.value.trim() ? desktopInput.value.trim() : "";
            if (!trackingId && mobileInput) {
                trackingId = mobileInput.value.trim();
            }

            if (trackingId) {
                trackingId = trackingId.split("\n")[0].trim();
                
                
                // Set loading state
                const originalBtnText = homeTrackBtn.innerHTML;
                homeTrackBtn.disabled = true;
                homeTrackBtn.textContent = "Loading...";

                try {
                    // Fetch from Supabase
                    
                    // Fetch from Supabase with JOIN
                    
                    // Fetch from Supabase using helper
                    let shipment;
                    let error = null;
                    try {
                        shipment = await window.db.getShipmentByTrackingNumber(trackingId.toUpperCase());
                    } catch (err) {
                        error = err;
                    }



                    if (shipment) {
                        // Map snake_case from DB to camelCase used by renderShipment
                        
                        // Format tracking_events to match old timeline structure
                        let formattedTimeline = [];
                        if (shipment.tracking_events) {
                            // Sort events by timestamp descending
                            shipment.tracking_events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                            
                            formattedTimeline = shipment.tracking_events.map(ev => {
                                const d = new Date(ev.created_at);
                                return {
                                    date: d.toLocaleDateString(),
                                    time: d.toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"}),
                                    status: ev.status,
                                    location: ev.location
                                };
                            });
                        }

                        // Map relational nested objects to frontend display
                        const mappedShipment = {
                            trackingNumber: shipment.tracking_number,
                            senderName: shipment.senders?.full_name || 'N/A',
                            receiverName: shipment.receivers?.full_name || 'N/A',
                            origin: `${shipment.senders?.city || ''}, ${shipment.senders?.country || ''}`,
                            destination: `${shipment.receivers?.city || ''}, ${shipment.receivers?.country || ''}`,
                            status: shipment.status,
                            estimatedDelivery: shipment.estimated_delivery,
                            service: shipment.shipping_method || 'Standard',
                            weight: shipment.packages?.weight ? `${shipment.packages.weight} lbs` : '',
                            dimensions: shipment.packages?.length ? `${shipment.packages.length}x${shipment.packages.width}x${shipment.packages.height} in` : 'N/A',
                            timeline: formattedTimeline.length > 0 ? formattedTimeline : (shipment.timeline || [])
                        };


                        renderShipment(mappedShipment);
                        if (searchViewContainer) searchViewContainer.style.display = "none";
                        resultView.style.display = "block";
                    } else {
                        const errMsg = error ? (error.message || JSON.stringify(error)) : "Not found in database";
                        alert("Error finding tracking number: " + errMsg);
                    }
                } catch (err) {
                    console.error("Tracking Error:", err);
                    alert("An error occurred while tracking. Please try again.");
                } finally {
                    // Reset button
                    homeTrackBtn.disabled = false;
                    homeTrackBtn.innerHTML = originalBtnText;
                }
            } else {
                alert("Please enter a tracking number.");
            }
        });
    }

    if (backToResultsBtn) {
        backToResultsBtn.addEventListener("click", (e) => {
            e.preventDefault();
            resultView.style.display = "none";
            if (searchViewContainer) searchViewContainer.style.display = "block";
            const desktopInput = document.getElementById("home-track-desktop");
            const mobileInput = document.getElementById("home-track-mobile");
            if(desktopInput) desktopInput.value = "";
            if(mobileInput) mobileInput.value = "";
        });
    }

    function renderShipment(shipment) {
        window.currentShipmentData = shipment;
        document.getElementById("res-tracking-number").textContent = shipment.trackingNumber;
        document.getElementById("res-delivery-text").textContent = shipment.estimatedDelivery;
        document.getElementById("res-destination").textContent = shipment.destination;

        const isDelivered = shipment.status === "Delivered";
        const isClaim = shipment.status === "Claim in Progress";

        if (isDelivered) {
            document.getElementById("res-status-label").innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#008272" stroke-width="2" fill="none" style="vertical-align: text-bottom; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Delivered On`;
            proofContainer.style.display = "block";
            changeDeliveryBtn.style.display = "none";
            document.getElementById("res-delivery-text").style.color = "#008272";
        } else if (isClaim) {
            document.getElementById("res-status-label").textContent = "Estimated delivery";
            document.getElementById("res-delivery-text").textContent = "Information not available.";
            document.getElementById("res-delivery-text").style.color = "#008272";
            claimAlert.style.display = "flex";
            proofContainer.style.display = "none";
            changeDeliveryBtn.style.display = "inline-block";
        } else {
            document.getElementById("res-status-label").textContent = "Estimated delivery";
            document.getElementById("res-delivery-text").textContent = shipment.estimatedDelivery || "The delivery date will be provided as soon as possible.";
            document.getElementById("res-delivery-text").style.color = "#008272";
            claimAlert.style.display = "none";
            proofContainer.style.display = "none";
            changeDeliveryBtn.style.display = "inline-block";
        }

        const timelineContainer = document.getElementById("timeline-container");
        timelineContainer.innerHTML = "";
        const standardSequence = ["Pending", "Picked Up", "In Transit", "Arrived", "Out For Delivery", "Delivered"];
        
        let currentStateIndex = standardSequence.indexOf(shipment.status);
        if(isClaim) currentStateIndex = 1;
        if(isDelivered) currentStateIndex = standardSequence.length - 1;

        const events = shipment.timeline || [];
        let timelineHTML = "";
        const statusesToRender = isClaim ? ["Label Created", "Claim in Progress"] : standardSequence;

        statusesToRender.forEach((step, index) => {
            const isCompleted = index < currentStateIndex || (isDelivered && index <= currentStateIndex);
            const isCurrent = index === currentStateIndex;
            const isFuture = index > currentStateIndex;
            
            let itemClass = "timeline-item";
            if (isCompleted) itemClass += " completed";
            if (isCurrent) itemClass += " current";
            if (isFuture) itemClass += " dotted";

            let iconHTML = "";
            if (isCurrent) {
                iconHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
            }

            timelineHTML += `
                <div class="${itemClass}">
                    <div class="timeline-icon">${iconHTML}</div>
                    <div class="timeline-content">${step}</div>
                </div>
            `;
        });
        
        timelineContainer.innerHTML = timelineHTML;

        const now = new Date();
        const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString();
        document.getElementById("modal-last-updated").textContent = dateStr;
        
        document.getElementById("modal-tracking").textContent = shipment.trackingNumber;
        document.getElementById("modal-service").textContent = shipment.service || "UPS Worldwide Express Saver®";
        document.getElementById("modal-weight").textContent = shipment.weight || "9.00 KGS";
        
        // Granular V3 variables
        if(document.getElementById("modal-dimensions")) document.getElementById("modal-dimensions").textContent = shipment.dimensions;
        if(document.getElementById("modal-sender")) document.getElementById("modal-sender").textContent = shipment.senderName + ' - ' + shipment.origin;
        if(document.getElementById("modal-receiver")) document.getElementById("modal-receiver").textContent = shipment.receiverName + ' - ' + shipment.destination;
        
        const shippedOn = events.length > 0 ? events[0].date : "N/A";
        document.getElementById("modal-shipped-on").textContent = shippedOn;

        const historyContainer = document.getElementById("modal-progress-history");
        let historyHTML = "";
        [...events].reverse().forEach(ev => {
            historyHTML += `
                <div class="history-row">
                    <div class="history-date">
                        <div>${ev.date}</div>
                        <div>${ev.time}</div>
                    </div>
                    <div class="history-status">
                        <div class="history-status-main">${ev.status}</div>
                        <div class="history-location">${ev.location}</div>
                    </div>
                </div>
            `;
        });
        historyContainer.innerHTML = historyHTML;

        if (isDelivered) {
            document.getElementById("proof-tracking").textContent = shipment.trackingNumber;
            document.getElementById("proof-weight").textContent = shipment.weight || "9.00 KGS";
            document.getElementById("proof-service").textContent = shipment.service || "UPS Worldwide Express Saver®";
            document.getElementById("proof-shipped").textContent = shippedOn;
            
            const deliveryEvent = events.find(e => e.status.includes("Deliver"));
            const deliveredOn = deliveryEvent ? `${deliveryEvent.date} ${deliveryEvent.time}` : "N/A";
            document.getElementById("proof-delivered").textContent = deliveredOn;
            document.getElementById("proof-delivered-to").textContent = shipment.destination;
            document.getElementById("proof-timestamp").textContent = dateStr;
        }
    }

    if (downloadReceiptBtn) {
        downloadReceiptBtn.addEventListener("click", () => {
            if (!window.currentShipmentData) return;
            const data = window.currentShipmentData;
            
            const receiptWindow = window.open("", "_blank");
            if (!receiptWindow) {
                alert("Please allow popups to download your receipt.");
                return;
            }
            
            const receiptHTML = `
                <html>
                <head>
                    <title>Receipt - ${data.trackingNumber}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; }
                        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #ffb500; padding-bottom: 20px; margin-bottom: 30px; }
                        .header img { height: 60px; }
                        .title { font-size: 24px; font-weight: bold; color: #333; }
                        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                        .info-box { background: #f8f9fa; padding: 15px; border-radius: 5px; border: 1px solid #e9ecef; }
                        .label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
                        .value { font-size: 16px; font-weight: bold; }
                        .section-title { font-size: 18px; font-weight: bold; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
                        .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                        .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
                        .table th { background-color: #f8f9fa; font-weight: bold; color: #555; }
                        .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 20px; }
                        @media print {
                            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                            button { display: none; }
                        }
                        .print-btn { background: #ffb500; color: #000; border: none; padding: 10px 20px; font-weight: bold; cursor: pointer; border-radius: 20px; float: right; }
                        .clear { clear: both; }
                    </style>
                </head>
                <body>
                    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
                    <div class="clear"></div>
                    <div class="header">
                        <div>
                            <div class="title">Parcel Receipt</div>
                            <div style="margin-top: 10px; color: #666;">Date: ${new Date().toLocaleDateString()}</div>
                        </div>
                        <div>
                            <!-- UPS Logo svg placeholder -->
                            <svg viewBox="0 0 40 46" height="50" width="50" xmlns="http://www.w3.org/2000/svg">
                                <path fill="#ffb500" d="M29.5 0h-19C4.7 0 0 4.7 0 10.5v25C0 41.3 4.7 46 10.5 46h19c5.8 0 10.5-4.7 10.5-10.5v-25C40 4.7 35.3 0 29.5 0z"/>
                                <path fill="#3a2618" d="M30 6H10C7.8 6 6 7.8 6 10v26c0 2.2 1.8 4 4 4h20c2.2 0 4-1.8 4-4V10c0-2.2-1.8-4-4-4zm-2.8 28.5L20 30l-7.2 4.5v-18l7.2-4.5 7.2 4.5v18z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="info-grid">
                        <div class="info-box">
                            <div class="label">Tracking Number</div>
                            <div class="value">${data.trackingNumber}</div>
                        </div>
                        <div class="info-box">
                            <div class="label">Status</div>
                            <div class="value">${data.status}</div>
                        </div>
                        <div class="info-box">
                            <div class="label">From</div>
                            <div class="value">${data.origin || 'N/A'}</div>
                        </div>
                        <div class="info-box">
                            <div class="label">To</div>
                            <div class="value">${data.destination || 'N/A'}</div>
                        </div>
                        <div class="info-box">
                            <div class="label">Service</div>
                            <div class="value">${data.service || 'Standard'}</div>
                        </div>
                        <div class="info-box">
                            <div class="label">Weight</div>
                            <div class="value">${data.weight || 'N/A'}</div>
                        </div>
                    </div>
                    
                    <div class="section-title">Shipment Details</div>
                    <table class="table">
                        <tr>
                            <th>Estimated Delivery</th>
                            <td>${data.estimatedDelivery || 'Pending'}</td>
                        </tr>
                        <tr>
                            <th>Shipped On</th>
                            <td>${data.shipped_on || 'Pending'}</td>
                        </tr>
                    </table>

                    <div class="footer">
                        Thank you for using our services.<br>
                        This is an automatically generated receipt.
                    </div>
                    <script>
                        // Auto-print on load
                        setTimeout(() => { window.print(); }, 500);
                    </script>
                </body>
                </html>
            `;
            
            receiptWindow.document.write(receiptHTML);
            receiptWindow.document.close();
        });
    }
});
