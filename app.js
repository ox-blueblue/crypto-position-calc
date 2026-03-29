const DEFAULT_FEES = {
    binance: { spot: 0.1, futures: 0.05 },
    okx: { spot: 0.1, futures: 0.05 },
    bitget: { spot: 0.1, futures: 0.06 },
    bybit: { spot: 0.1, futures: 0.055 },
    hyperliquid: { spot: 0.07, futures: 0.045 }
};

const EXCHANGE_NAMES = {
    binance: 'Binance',
    okx: 'OKX',
    bitget: 'Bitget',
    bybit: 'Bybit',
    hyperliquid: 'Hyperliquid'
};

let customFees = null;

function getFees() {
    if (customFees) return customFees;
    const stored = localStorage.getItem('customFees');
    if (stored) {
        customFees = JSON.parse(stored);
        return customFees;
    }
    return DEFAULT_FEES;
}

function saveCustomFees(fees) {
    customFees = fees;
    localStorage.setItem('customFees', JSON.stringify(fees));
}

function resetFees() {
    customFees = null;
    localStorage.removeItem('customFees');
}

function calculate(data) {
    const { exchange, symbol, balance, entryPrice, stopLoss, takeProfit, leverage = 1, riskPercent = 1 } = data;

    if (entryPrice === stopLoss) {
        throw new Error('开仓价格和止损价格不能相同');
    }

    const direction = stopLoss < entryPrice ? 'long' : 'short';

    const isFutures = leverage > 1;
    const fees = getFees();
    const feeRate = isFutures ? fees[exchange].futures / 100 : fees[exchange].spot / 100;
    const feeRateDisplay = isFutures ? fees[exchange].futures : fees[exchange].spot;

    const stopLossDistance = direction === 'long'
        ? (entryPrice - stopLoss) / entryPrice
        : (stopLoss - entryPrice) / entryPrice;

    const maxLoss = balance * (riskPercent / 100);

    const doubleFeeRate = feeRate * 2;
    const actualStopCost = stopLossDistance + doubleFeeRate;

    if (actualStopCost <= 0) {
        throw new Error('实际止损成本为负，请检查止损价格');
    }

    const nominalPosition = maxLoss / actualStopCost;
    const margin = nominalPosition / leverage;
    const quantity = nominalPosition / entryPrice;

    const takeProfitDistance = direction === 'long'
        ? (takeProfit - entryPrice) / entryPrice
        : (entryPrice - takeProfit) / entryPrice;

    const expectedProfit = nominalPosition * takeProfitDistance - nominalPosition * doubleFeeRate;
    const actualProfitRatio = maxLoss > 0 ? expectedProfit / maxLoss : 0;
    const marginRatio = (margin / balance) * 100;

    return {
        direction,
        symbol,
        exchange,
        exchangeName: EXCHANGE_NAMES[exchange],
        type: isFutures ? '合约' : '现货',
        feeRate: feeRateDisplay.toFixed(3),
        balance,
        riskPercent,
        maxLoss,
        entryPrice,
        stopLoss,
        takeProfit,
        stopLossDistance: (stopLossDistance * 100).toFixed(2),
        doubleFeeRate: (doubleFeeRate * 100).toFixed(3),
        actualStopCost: (actualStopCost * 100).toFixed(2),
        leverage,
        nominalPosition: nominalPosition.toFixed(2),
        margin: margin.toFixed(2),
        quantity: quantity.toFixed(6),
        expectedProfit: expectedProfit.toFixed(2),
        profitRatio: actualProfitRatio.toFixed(2),
        marginRatio: marginRatio.toFixed(2)
    };
}

function checkRisks(data, calc) {
    const risks = [];

    if (calc.margin > calc.balance) {
        risks.push({ type: 'error', text: '保证金超出账户余额，无法开仓。请减小仓位或降低杠杆。' });
    }

    if (calc.marginRatio > 30) {
        risks.push({ type: 'warning', text: `保证金占比超30%（${calc.marginRatio}%），仓位偏重，注意集中度风险。` });
    }

    if (calc.profitRatio < 1) {
        risks.push({ type: 'error', text: '盈亏比不足1:1，收益不覆盖风险，建议调整止盈止损位。' });
    } else if (calc.profitRatio < 3) {
        risks.push({ type: 'warning', text: `盈亏比${calc.profitRatio}:1，建议3:1以上更安全。` });
    }

    const stopLossDistance = parseFloat(calc.stopLossDistance) / 100;
    const doubleFeeRate = parseFloat(calc.doubleFeeRate) / 100;
    if (stopLossDistance < doubleFeeRate) {
        risks.push({ type: 'error', text: '止损距离小于手续费成本，不管涨跌都亏，请扩大止损。' });
    }

    if (calc.leverage > 20) {
        risks.push({ type: 'warning', text: `高杠杆交易（${calc.leverage}x），极端行情下可能被强平，确认你能承受。` });
    }

    const direction = calc.direction;
    const isWrongDirection = (direction === 'long' && calc.stopLoss > calc.entryPrice) ||
                             (direction === 'short' && calc.stopLoss < calc.entryPrice);
    if (isWrongDirection) {
        risks.push({ type: 'error', text: '止损方向错误，请检查输入。' });
    }

    return risks;
}

function renderResult(calc, risks) {
    const directionText = calc.direction === 'long' ? '做多 ▲' : '做空 ▼';
    const directionClass = calc.direction === 'long' ? 'direction-long' : 'direction-short';
    const symbolDisplay = calc.symbol ? `<span>${calc.symbol}</span>` : '';
    const symbolUnit = calc.symbol ? calc.symbol : '';

    const html = `
        <table class="result-table">
            <tr>
                <th>交易所</th>
                <td>${calc.exchangeName}（${calc.type} Taker 费率 ${calc.feeRate}%）</td>
            </tr>
            <tr>
                <th>账户总额</th>
                <td>${calc.balance.toLocaleString()} USDT</td>
            </tr>
            <tr>
                <th>止损亏损</th>
                <td>${calc.maxLoss.toFixed(2)} USDT</td>
            </tr>
            <tr>
                <th>预期盈利</th>
                <td>${parseFloat(calc.expectedProfit).toLocaleString()} USDT</td>
            </tr>
            <tr>
                <th><strong>盈亏比</strong></th>
                <td><span class="big-highlight">${calc.profitRatio} : 1</span></td>
            </tr>
            <tr>
                <th><strong>开仓数量</strong></th>
                <td><span class="big-highlight">${calc.quantity} ${symbolUnit}</span></td>
            </tr>
            <tr>
                <th><strong>实际仓位</strong></th>
                <td><span class="big-highlight">${parseFloat(calc.nominalPosition).toLocaleString()} USDT</span></td>
            </tr>
            <tr>
                <th><strong>保证金</strong></th>
                <td><span class="big-highlight">${parseFloat(calc.margin).toLocaleString()} USDT</span></td>
            </tr>
            <tr>
                <th>开仓价格</th>
                <td>${parseFloat(calc.entryPrice).toLocaleString()}</td>
            </tr>
            <tr>
                <th>止损价格</th>
                <td>${parseFloat(calc.stopLoss).toLocaleString()}</td>
            </tr>
            <tr>
                <th>止盈价格</th>
                <td>${parseFloat(calc.takeProfit).toLocaleString()}</td>
            </tr>
            <tr>
                <th>止损距离</th>
                <td>${calc.stopLossDistance}%</td>
            </tr>
            <tr>
                <th>手续费（双边）</th>
                <td>${calc.doubleFeeRate}%</td>
            </tr>
            <tr>
                <th>实际止损成本</th>
                <td>${calc.actualStopCost}%</td>
            </tr>
            <tr>
                <th>杠杆倍数</th>
                <td>${calc.leverage}x</td>
            </tr>
            <tr>
                <th>保证金占比</th>
                <td>${calc.marginRatio}%</td>
            </tr>
        </table>
    `;

    document.getElementById('resultContent').innerHTML = html;
    
    const resultTitle = document.querySelector('#resultSection h2');
    resultTitle.innerHTML = `仓位计算结果 <span class="${directionClass}">${directionText}</span>`;
    
    document.getElementById('resultSection').style.display = 'block';

    const riskList = document.getElementById('riskList');
    riskList.innerHTML = '';

    if (risks.length === 0) {
        const li = document.createElement('li');
        li.className = 'risk-success';
        li.textContent = '✅ 所有风险检查通过';
        riskList.appendChild(li);
    } else {
        risks.forEach(risk => {
            const li = document.createElement('li');
            li.className = risk.type === 'error' ? 'risk-error' : 'risk-warning';
            li.textContent = risk.type === 'error' ? '❌ ' + risk.text : '⚠️ ' + risk.text;
            riskList.appendChild(li);
        });
    }

    document.getElementById('riskSection').style.display = 'block';

    document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFeeSettings() {
    const fees = getFees();
    const container = document.getElementById('feeSettings');
    container.innerHTML = '';

    for (const [key, name] of Object.entries(EXCHANGE_NAMES)) {
        const row = document.createElement('div');
        row.className = 'fee-row';
        row.innerHTML = `
            <label>${name}</label>
            <input type="number" step="0.001" min="0" placeholder="现货" value="${fees[key].spot}" data-exchange="${key}" data-type="spot">
            <input type="number" step="0.001" min="0" placeholder="合约" value="${fees[key].futures}" data-exchange="${key}" data-type="futures">
        `;
        container.appendChild(row);
    }
}

function openSettingsModal() {
    renderFeeSettings();
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

function saveFees() {
    const rows = document.querySelectorAll('.fee-row');
    const newFees = {};

    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const exchange = inputs[0].dataset.exchange;
        newFees[exchange] = {
            spot: parseFloat(inputs[0].value) || 0.1,
            futures: parseFloat(inputs[1].value) || 0.05
        };
    });

    saveCustomFees(newFees);
    closeSettingsModal();
    
    const form = document.getElementById('calcForm');
    if (form.classList.contains('submitted')) {
        form.dispatchEvent(new Event('submit'));
    }
}

document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('closeModal').addEventListener('click', closeSettingsModal);
document.getElementById('saveFees').addEventListener('click', saveFees);
document.getElementById('resetFees').addEventListener('click', function() {
    resetFees();
    renderFeeSettings();
});

document.getElementById('settingsModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeSettingsModal();
    }
});

document.getElementById('calcForm').addEventListener('submit', function(e) {
    e.preventDefault();
    this.classList.add('submitted');

    const symbol = document.getElementById('symbol').value.trim().toUpperCase();
    let balance = parseFloat(document.getElementById('balance').value);
    if (!balance || balance <= 0) balance = 1000;
    const entryPrice = parseFloat(document.getElementById('entryPrice').value);
    const stopLoss = parseFloat(document.getElementById('stopLoss').value);
    const takeProfit = parseFloat(document.getElementById('takeProfit').value);

    if (!entryPrice || entryPrice <= 0) {
        alert('请输入有效的开仓价格');
        return;
    }
    if (!stopLoss || stopLoss <= 0) {
        alert('请输入有效的止损价格');
        return;
    }
    if (!takeProfit || takeProfit <= 0) {
        alert('请输入有效的止盈价格');
        return;
    }

    const data = {
        exchange: document.getElementById('exchange').value,
        symbol: symbol.toUpperCase(),
        balance: balance,
        entryPrice: entryPrice,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        leverage: parseInt(document.getElementById('leverage').value) || 1,
        riskPercent: parseFloat(document.getElementById('riskPercent').value) || 1
    };

    try {
        const calc = calculate(data);
        const risks = checkRisks(data, calc);
        renderResult(calc, risks);
    } catch (error) {
        alert(error.message);
    }
});
