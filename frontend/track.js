document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const searchView = document.getElementById('search-view');
    const resultView = document.getElementById('result-view');
    const trackingForm = document.getElementById('tracking-form');
    const trackInput = document.getElementById('trackInput');
    const searchError = document.getElementById('search-error');
    const backToResultsBtn = document.getElementById('back-to-results');
    const claimAlert = document.getElementById('claim-alert');
    
    // Modals
    const detailsModal = document.getElementById('details-modal');
    const proofModal = document.getElementById('proof-modal');
    const viewDetailsBtn = document.getElementById('view-details-btn');
    const proofBtn = document.getElementById('proof-btn');
    const proofContainer = document.getElementById('proof-container');
    const changeDeliveryBtn = document.getElementById('change-delivery-btn');

    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    // Close Modals
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.target.getAttribute('data-modal') || e.target.closest('.modal-backdrop').id;
            document.getElementById(modalId).style.display = 'none';
        });
    });

    // Open Details Modal
    viewDetailsBtn.addEventListener('click', () => {
        detailsModal.style.display = 'flex';
    });

    // Open Proof Modal
    if(proofBtn) {
        proofBtn.addEventListener('click', () => {
            proofModal.style.display = 'flex';
        });
    }

    // Tab Switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.style.display = 'none');
            
            btn.classList.add('active');
            const target = btn.getAttribute('data-target');
            document.getElementById(target).style.display = 'block';
        });
    });

    // Form Submit
    trackingForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const trackingId = trackInput.value.trim();
        searchError.style.display = 'none';

        let shipments = JSON.parse(localStorage.getItem('shipments')) || {};
        let shipment = shipments[trackingId];

        // Auto-generate mock data if it looks like a UPS tracking number but wasn't created in admin panel
        if (!shipment && trackingId.toUpperCase().startsWith('1Z')) {
            shipment = {
                trackingNumber: trackingId.toUpperCase(),
                customer: "Valued Customer",
                origin: "HONG KONG",
                destination: "PHOENIX, AZ US",
                status: "On the Way",
                estimatedDelivery: "The delivery date will be provided as soon as possible.",
                service: "UPS Worldwide Express Saver®",
                weight: "9.00 KGS",
                timeline: [
                    { date: new Date().toLocaleDateString(), time: "10:00 AM", status: "Label Created", location: "HONG KONG" },
                    { date: new Date().toLocaleDateString(), time: "06:01 AM", status: "On the Way", location: "DUBLIN, IE" }
                ]
            };
            // Save it so it persists
            shipments[shipment.trackingNumber] = shipment;
            localStorage.setItem('shipments', JSON.stringify(shipments));
        }

        if (shipment) {
            renderShipment(shipment);
            searchView.style.display = 'none';
            resultView.style.display = 'block';
        } else {
            searchError.style.display = 'block';
        }
    });

    // Back to Results
    backToResultsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Clear the tracking number from the URL so it's a clean slate
        window.history.pushState({}, document.title, window.location.pathname);
        
        resultView.style.display = 'none';
        searchView.style.display = 'block';
        trackInput.value = '';
    });

    function renderShipment(shipment) {
        // Main Result View
        document.getElementById('res-tracking-number').textContent = shipment.trackingNumber;
        document.getElementById('res-delivery-text').textContent = shipment.estimatedDelivery;
        document.getElementById('res-destination').textContent = shipment.destination;

        // Status Specific Logic
        const isDelivered = shipment.status === 'Delivered';
        const isClaim = shipment.status === 'Claim in Progress';

        if (isDelivered) {
            document.getElementById('res-status-label').innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#008272" stroke-width="2" fill="none" style="vertical-align: text-bottom; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Delivered On`;
            proofContainer.style.display = 'block';
            changeDeliveryBtn.style.display = 'none';
            document.getElementById('res-delivery-text').style.color = '#008272';
        } else if (isClaim) {
            document.getElementById('res-status-label').textContent = 'Estimated delivery';
            document.getElementById('res-delivery-text').textContent = 'Information not available.';
            document.getElementById('res-delivery-text').style.color = '#008272';
            claimAlert.style.display = 'flex';
            proofContainer.style.display = 'none';
            changeDeliveryBtn.style.display = 'inline-block';
        } else {
            document.getElementById('res-status-label').textContent = 'Estimated delivery';
            document.getElementById('res-delivery-text').textContent = shipment.estimatedDelivery || 'The delivery date will be provided as soon as possible.';
            document.getElementById('res-delivery-text').style.color = '#008272';
            claimAlert.style.display = 'none';
            proofContainer.style.display = 'none';
            changeDeliveryBtn.style.display = 'inline-block';
        }

        // Render Timeline
        const timelineContainer = document.getElementById('timeline-container');
        timelineContainer.innerHTML = '';

        // Standard sequence (simplified)
        const standardSequence = ['Label Created', 'Cleared Import Customs', 'On the Way', 'Out for Delivery', 'Delivery'];
        
        let currentStateIndex = standardSequence.indexOf(shipment.status);
        if(isClaim) currentStateIndex = 1; // Arbitrary for UI
        if(isDelivered) currentStateIndex = standardSequence.length - 1;

        // Custom timeline generation based on mock events
        // If there are mock events, we should use them to determine completed steps
        const events = shipment.timeline || [];
        
        let timelineHTML = '';
        const statusesToRender = isClaim ? ['Label Created', 'Claim in Progress'] : standardSequence;

        statusesToRender.forEach((step, index) => {
            const isCompleted = index < currentStateIndex || (isDelivered && index <= currentStateIndex);
            const isCurrent = index === currentStateIndex;
            const isFuture = index > currentStateIndex;
            
            let itemClass = 'timeline-item';
            if (isCompleted) itemClass += ' completed';
            if (isCurrent) itemClass += ' current';
            if (isFuture) itemClass += ' dotted';

            let iconHTML = '';
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

        // Modals Data Population
        const now = new Date();
        const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
        document.getElementById('modal-last-updated').textContent = dateStr;
        
        document.getElementById('modal-tracking').textContent = shipment.trackingNumber;
        document.getElementById('modal-service').textContent = shipment.service || 'UPS Worldwide Express Saver®';
        document.getElementById('modal-weight').textContent = shipment.weight || '9.00 KGS';
        
        const shippedOn = events.length > 0 ? events[0].date : 'N/A';
        document.getElementById('modal-shipped-on').textContent = shippedOn;

        // Render Modal Progress History
        const historyContainer = document.getElementById('modal-progress-history');
        let historyHTML = '';
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

        // Proof of Delivery Data
        if (isDelivered) {
            document.getElementById('proof-tracking').textContent = shipment.trackingNumber;
            document.getElementById('proof-weight').textContent = shipment.weight || '9.00 KGS';
            document.getElementById('proof-service').textContent = shipment.service || 'UPS Worldwide Express Saver®';
            document.getElementById('proof-shipped').textContent = shippedOn;
            
            const deliveryEvent = events.find(e => e.status.includes('Deliver'));
            const deliveredOn = deliveryEvent ? `${deliveryEvent.date} ${deliveryEvent.time}` : 'N/A';
            document.getElementById('proof-delivered').textContent = deliveredOn;
            document.getElementById('proof-delivered-to').textContent = shipment.destination;
            document.getElementById('proof-timestamp').textContent = dateStr;
        }
    }
    // Support for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const trackingIdParam = urlParams.get("trackingNumber");
    if (trackingIdParam) {
        trackInput.value = trackingIdParam;
        // Create event that bubbles and is cancelable so preventDefault works
        const submitEvent = new Event("submit", {
            bubbles: true,
            cancelable: true
        });
        trackingForm.dispatchEvent(submitEvent);
    }
});

