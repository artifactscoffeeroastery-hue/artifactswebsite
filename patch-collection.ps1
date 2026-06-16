# patch-collection.ps1
# Patches index.html to add collection shipping option + localStorage save for return page
# Run from: C:\Users\dgroo\Documents\Artifacts Coffee\Artifacts website\OG site\
# Usage: Right-click > Run with PowerShell  OR  powershell -ExecutionPolicy Bypass -File patch-collection.ps1

$file = Join-Path $PSScriptRoot "index.html"

if (-not (Test-Path $file)) {
    Write-Host "ERROR: index.html not found at $file" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit
}

$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
$changes = 0

# ── 1. Add collection to STATIC shipping dropdown (the HTML default options) ──
$old1 = '<option value="60">TCG PUDO Locker - R60.00</option>'
$new1 = '<option value="0" data-rate="0" data-code="collect">&#127968; Collect from Johannesburg &mdash; R0.00</option>
                <option value="60">TCG PUDO Locker - R60.00</option>'

if ($content.Contains($old1)) {
    $content = $content.Replace($old1, $new1)
    $changes++
    Write-Host "✅ 1. Collection option added to static dropdown" -ForegroundColor Green
} else {
    Write-Host "⚠️  1. Static dropdown string not found — may already be patched" -ForegroundColor Yellow
}

# ── 2. Add collection to fallbackQuotes in fetchShippingQuotes function ──
$old2 = "    const fallbackQuotes = [
        { code: 'pudo', label: 'TCG PUDO Locker', amount: 60 },
        { code: 'door-gauteng', label: 'Gauteng Door-to-Door', amount: 100 },
        { code: 'door-national', label: 'Rest of SA Door-to-Door', amount: 150 }
    ];"

$new2 = "    const fallbackQuotes = [
        { code: 'collect', label: 'Collect from Johannesburg', amount: 0 },
        { code: 'pudo', label: 'TCG PUDO Locker', amount: 60 },
        { code: 'door-gauteng', label: 'Gauteng Door-to-Door', amount: 100 },
        { code: 'door-national', label: 'Rest of SA Door-to-Door', amount: 150 }
    ];"

if ($content.Contains($old2)) {
    $content = $content.Replace($old2, $new2)
    $changes++
    Write-Host "✅ 2. Collection added to fallbackQuotes" -ForegroundColor Green
} else {
    Write-Host "⚠️  2. fallbackQuotes string not found — check formatting" -ForegroundColor Yellow
}

# ── 3. Prepend collect option in renderShippingOptions (dynamic render) ──
$old3 = "    shippingSelect.innerHTML = quotes.map((quote) => {"
$new3 = "    // Always prepend collect option regardless of TCG response
    const hasCollect = quotes.some(q => q.code === 'collect');
    if (!hasCollect) quotes.unshift({ code: 'collect', label: 'Collect from Johannesburg', amount: 0 });

    shippingSelect.innerHTML = quotes.map((quote) => {"

if ($content.Contains($old3)) {
    $content = $content.Replace($old3, $new3)
    $changes++
    Write-Host "✅ 3. Collect option prepended in renderShippingOptions" -ForegroundColor Green
} else {
    Write-Host "⚠️  3. renderShippingOptions string not found — check formatting" -ForegroundColor Yellow
}

# ── 4. Save shipping method to localStorage before PayFast redirect ──
$old4 = "    calcTotal();
    return true;
}"

$new4 = "    calcTotal();

    // Save shipping method so return.html can show collection instructions
    const _shippingEl = document.getElementById('tcg-shipping');
    const _selectedOpt = _shippingEl && _shippingEl.options[_shippingEl.selectedIndex];
    if (_selectedOpt) {
        localStorage.setItem('last_shipping_code', _selectedOpt.getAttribute('data-code') || '');
        localStorage.setItem('last_shipping_label', _selectedOpt.textContent.trim());
    }
    return true;
}"

if ($content.Contains($old4)) {
    $content = $content.Replace($old4, $new4)
    $changes++
    Write-Host "✅ 4. localStorage save added before PayFast redirect" -ForegroundColor Green
} else {
    Write-Host "⚠️  4. validateCheckoutBeforePay closing block not found" -ForegroundColor Yellow
}

# ── 5. Show WhatsApp note in cart when collection is selected ──
$old5 = "    calcTotal();
}

function getCartWeightKg()"

$new5 = "    calcTotal();

    // Show/hide collection note
    const _select = document.getElementById('tcg-shipping');
    const _collectNote = document.getElementById('collect-note');
    if (_select && _collectNote) {
        const _code = _select.options[_select.selectedIndex] && _select.options[_select.selectedIndex].getAttribute('data-code');
        _collectNote.style.display = _code === 'collect' ? 'block' : 'none';
    }
}

function getCartWeightKg()"

if ($content.Contains($old5)) {
    $content = $content.Replace($old5, $new5)
    $changes++
    Write-Host "✅ 5. Collection note toggle added to calcTotal" -ForegroundColor Green
} else {
    Write-Host "⚠️  5. calcTotal closing block not found" -ForegroundColor Yellow
}

# ── 6. Insert collect-note div after shipping box ──
$old6 = '            <div id="shipping-rate-status"'
$new6 = '            <div id="collect-note" style="display:none; margin-top:10px; background:rgba(225,255,1,0.06); border:1px solid rgba(225,255,1,0.2); border-radius:4px; padding:12px 14px; font-size:11px; color:#ccc; font-family:''DM Mono'',monospace; line-height:1.7;">
                <span style="color:var(--yellow); font-family:''Barlow Condensed'',sans-serif; font-size:12px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase;">Collection</span><br>
                Complete payment and we will contact you on WhatsApp to confirm a collection time in Johannesburg.<br>
                <a href="https://wa.me/27613832478" target="_blank" style="color:var(--yellow); font-weight:600;">&#9889; +27 61 383 2478</a>
            </div>
            <div id="shipping-rate-status"'

if ($content.Contains($old6)) {
    $content = $content.Replace($old6, $new6)
    $changes++
    Write-Host "✅ 6. Collection note div inserted in cart" -ForegroundColor Green
} else {
    Write-Host "⚠️  6. shipping-rate-status div not found" -ForegroundColor Yellow
}

# ── WRITE FILE ──
if ($changes -gt 0) {
    [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
    Write-Host ""
    Write-Host "✅ $changes changes applied. index.html saved." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⚠️  No changes applied — file may already be patched." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to exit"
