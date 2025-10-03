// ************* 중요!! *************
// Firebase 콘솔에서 확인한 내 프로젝트의 설정 정보를 여기에 붙여넣으세요.
const firebaseConfig = {
  apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"
  
};
// **********************************

// Firebase 앱 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Firestore 컬렉션 참조
const transactionsCollection = db.collection('transactions');
const importCostSheetsCollection = db.collection('importCostSheets');

// 전역 변수
let inventory = [];
let transactions = [];
let ic_costSheets = [];
let editingTransactionId = null;
let ic_editingId = null;
let currentBackupFile = null;
let isInitialLoad = true; // 초기 로딩인지 확인하는 플래그

// ================== 0. 페이지 로딩 완료 후 실행 ==================
document.addEventListener('DOMContentLoaded', () => {
    const bulkCsvFileInput = document.getElementById('ic_bulk-csv-file');
    const bulkUploadProcessBtn = document.getElementById('ic_bulk-upload-process-btn');

    if (bulkCsvFileInput && bulkUploadProcessBtn) {
        bulkCsvFileInput.addEventListener('change', () => {
            bulkUploadProcessBtn.disabled = bulkCsvFileInput.files.length === 0;
        });
    }
});

// ================== 1. 인증 및 앱 초기화 ==================

auth.onAuthStateChanged(user => {
    if (user) {
        console.log('로그인 된 사용자:', user.email);
        initializeUIOnFirstLoad(); // 최초 1회만 UI 초기화
        setupRealtimeListeners(); // 실시간 데이터 감지 시작
    } else {
        console.log('로그인 필요');
        window.location.href = 'login.html';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => {
        console.log('로그아웃 성공');
        window.location.href = 'login.html';
    }).catch(error => console.error('로그아웃 실패:', error));
});

/**
 * [신규] 실시간 데이터 변경을 감지하는 리스너 설정
 */
function setupRealtimeListeners() {
    console.log("Firestore 실시간 리스너를 시작합니다...");

    // 입출고 내역 실시간 감지
    transactionsCollection.onSnapshot(snapshot => {
        transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`입출고 데이터 실시간 업데이트: ${transactions.length}건`);
        updateAll(); // 데이터 변경 시마다 전체 UI 갱신
    }, error => {
        console.error("입출고 리스너 오류:", error);
        alert("입출고 데이터를 실시간으로 동기화하는 데 실패했습니다.");
    });

    // 수입원가 내역 실시간 감지
    importCostSheetsCollection.onSnapshot(snapshot => {
        ic_costSheets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`수입원가 데이터 실시간 업데이트: ${ic_costSheets.length}건`);
        ic_renderList(); // 수입원가 목록 UI 갱신
    }, error => {
        console.error("수입원가 리스너 오류:", error);
        alert("수입원가 데이터를 실시간으로 동기화하는 데 실패했습니다.");
    });
}

/**
 * [신규] 페이지 첫 로드 시 1회만 실행되는 UI 초기화 함수
 */
function initializeUIOnFirstLoad() {
    console.log("UI 초기화를 시작합니다...");
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-date').value = today;
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    document.getElementById('invoice-start-date').value = firstDayOfMonth;
    document.getElementById('invoice-end-date').value = today;

    bindEventListeners();
    ic_addItemRow();
    console.log("초기 UI 설정 완료.");
}


function bindEventListeners() {
    ['filter-inv-brand', 'filter-inv-category', 'filter-inv-spec', 'filter-inv-lot', 
     'filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-category', 
     'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company']
    .forEach(id => document.getElementById(id).addEventListener('input', applyFiltersAndRender));

    ['filter-sales-start-date', 'filter-sales-end-date', 'filter-sales-company', 'filter-sales-brand']
    .forEach(id => document.getElementById(id).addEventListener('input', generateSalesReport));
  

    document.getElementById('tran-brand').addEventListener('blur', autoFillItemDetails);
    document.getElementById('tran-lot').addEventListener('blur', autoFillItemDetails);
}

// ================== 2. Firebase 데이터 처리 (CRUD) ==================

/**
 * * [수정됨] 실시간 동기화에 맞춰 로컬 데이터 조작 코드 제거
 */
async function processTransaction(isEdit) {
    const type = document.getElementById('transaction-type').value;
    const date = document.getElementById('transaction-date').value;
    const brand = document.getElementById('tran-brand').value.trim();
    const lot = document.getElementById('tran-lot').value.trim();
    const company = document.getElementById('transaction-company').value.trim();
    
    const weight = Number(document.getElementById('transaction-weight').value) || 0;
    const unitPrice = Number(document.getElementById('transaction-unit-price').value) || 0;
    const otherCosts = Number(document.getElementById('transaction-other-costs').value) || 0;

    if (!date || !brand || !lot || weight <= 0 || !company) {
        return alert('필수 항목(날짜, 브랜드, LOT, 중량, 업체)을 모두 입력해주세요.');
    }

    const record = {
        type, date, brand, lot, weight, unitPrice, company, otherCosts,
        category: document.getElementById('tran-category').value.trim(),
        spec: document.getElementById('tran-spec').value.trim(),
        notes: document.getElementById('transaction-notes').value.trim(),
        destination: document.getElementById('transaction-destination').value.trim(),
        specialNotes: document.getElementById('transaction-special-notes').value.trim()
    };

    try {
        if (isEdit && editingTransactionId) {
            await transactionsCollection.doc(editingTransactionId).update(record);
            alert('거래내역이 성공적으로 수정되었습니다.');
        } else {
            await transactionsCollection.add(record);
            alert('입출고 내역이 성공적으로 등록되었습니다.');
        }
        // 성공 후 폼만 초기화 (UI 업데이트는 실시간 리스너가 자동으로 처리)
        cancelTransactionEdit();
    } catch (error) {
        console.error("데이터 저장/수정 오류:", error);
        alert(`데이터를 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.\n\n오류: ${error.message}`);
    }
}

/**
 * * [수정됨] 실시간 동기화에 맞춰 로컬 데이터 조작 코드 제거
 */
async function processBulkTransactions(records) {
    const batch = db.batch();
    let successCount = 0;
    
    for (const record of records) {
        if (!record.date || !record.brand || !record.lot || record.weight <= 0 || !record.company) continue;
        const docRef = transactionsCollection.doc();
        batch.set(docRef, record);
        successCount++;
    }

    try {
        await batch.commit();
        // 로컬 데이터 조작 제거. 리스너가 자동으로 UI를 업데이트함.
        document.getElementById('bulk-upload-status').innerText = `총 ${records.length}건 중 ${successCount}건 처리 성공.`;
    } catch (error) {
        console.error("대량 등록 오류:", error);
        document.getElementById('bulk-upload-status').innerText = `오류 발생: ${error.message}`;
    }
}

/**
 * * [수정됨] 실시간 동기화에 맞춰 로컬 데이터 조작 코드 제거
 */
async function deleteSelectedTransactions() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 거래를 삭제하시겠습니까?`)) return;

    try {
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(transactionsCollection.doc(id)));
        await batch.commit();
        
        // 로컬 데이터 조작 제거. 리스너가 자동으로 UI를 업데이트함.
        alert(`${selectedIds.length}개의 거래가 삭제되었습니다.`);
    } catch (error) {
        console.error("데이터 삭제 오류:", error);
        alert("데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}

// ... (ic_processCostSheet, ic_deleteSelectedSheets 등 수입원가 관련 함수는 변경 없음) ...
async function ic_processCostSheet(isEdit) {
    const sheetData = {
        shipper: document.getElementById('form-shipper').value.trim(),
        terms: document.getElementById('form-terms').value.trim(),
        origin: document.getElementById('form-origin').value.trim(),
        method: document.getElementById('form-method').value.trim(),
        etd: document.getElementById('form-etd').value.trim(),
        eta: document.getElementById('form-eta').value.trim(),
        cbm: document.getElementById('form-cbm').value.trim(),
        packing: document.getElementById('form-packing').value.trim(),
        exchangeRate: document.getElementById('form-exchange-rate').value,
        shippingFee: document.getElementById('form-shipping-fee').value,
        tariffRate: document.getElementById('form-tariff-rate').value,
        tariffAmount: document.getElementById('form-tariff-amount').value,
        vatAmount: document.getElementById('form-vat-amount').value,
        forwarderFee1: document.getElementById('form-forwarder-fee1').value,
        forwarderFee2: document.getElementById('form-forwarder-fee2').value,
        forwarderFee3: document.getElementById('form-forwarder-fee3').value,
        items: []
    };
    
    document.querySelectorAll('#item-tbody tr').forEach(row => {
        const item = {
            name: row.querySelector('.item-name').value.trim(),
            lot: row.querySelector('.item-lot').value.trim(),
            qty: ic_pFloat(row.querySelector('.item-qty').value),
            unit: row.querySelector('.item-unit').value.trim(),
            price: ic_pFloat(row.querySelector('.item-price').value),
        };
        if (item.name && item.qty > 0) sheetData.items.push(item);
    });

    if (!sheetData.shipper || !sheetData.etd || ic_pFloat(sheetData.exchangeRate) === 0 || sheetData.items.length === 0) {
        return alert('필수 항목(Shipper, ETD, 적용환율, 품목 정보)을 모두 입력해주세요.');
    }
    
    let totalInvoiceValue = sheetData.items.reduce((sum, item) => sum + (item.qty * item.price), 0);
    const exchangeRate = ic_pFloat(sheetData.exchangeRate);
    const invoiceKrw = totalInvoiceValue * exchangeRate;
    const totalMaterialCost = invoiceKrw + ic_pFloat(sheetData.shippingFee);
    const tariffCost = ic_pFloat(sheetData.tariffAmount) > 0 ? ic_pFloat(sheetData.tariffAmount) : invoiceKrw * (ic_pFloat(sheetData.tariffRate) / 100);
    const totalForwarderFee = ic_pFloat(sheetData.forwarderFee1) + ic_pFloat(sheetData.forwarderFee2) + ic_pFloat(sheetData.forwarderFee3);
    const grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;
    sheetData.items.forEach(item => {
        item.unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
    });

    try {
        if (isEdit) {
            await importCostSheetsCollection.doc(ic_editingId).update(sheetData);
            alert('수정되었습니다.');
        } else {
            await importCostSheetsCollection.add(sheetData);
            alert('등록되었습니다.');
        }
        // 성공 후 폼만 초기화 (UI 업데이트는 실시간 리스너가 자동으로 처리)
        ic_clearForm();
    } catch (error) {
        console.error("정산서 저장 오류:", error);
        alert("정산서를 저장하는 중 오류가 발생했습니다.");
    }
}

async function ic_deleteSelectedSheets() {
    const selectedIds = Array.from(document.querySelectorAll('.sheet-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 정산 내역을 삭제하시겠습니까?`)) return;

    try {
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(importCostSheetsCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 정산 내역이 삭제되었습니다.`);
    } catch (error) {
        console.error("정산서 삭제 오류:", error);
        alert("정산서를 삭제하는 중 오류가 발생했습니다.");
    }
}

// ================== 3. 백업/복원 기능 추가 ==================

function backupDataToJson() {
    const backupData = { 
        transactions: transactions, 
        importCostSheets: ic_costSheets 
    };
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `grutex_firebase_backup_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
}

function loadBackupFile(event) {
    const file = event.target.files[0];
    if (file) {
        currentBackupFile = file;
        document.getElementById('backup-status').innerText = `선택된 파일: ${file.name}`;
        document.getElementById('restore-button').disabled = false;
    } else {
        currentBackupFile = null;
        document.getElementById('backup-status').innerText = '';
        document.getElementById('restore-button').disabled = true;
    }
}

/**
 * * [수정됨] 실시간 동기화에 맞춰 로컬 데이터 조작 코드 제거
 */
async function restoreDataFromJson() {
    if (!currentBackupFile) {
        return alert('먼저 복원할 백업 파일을 선택해주세요.');
    }
    const confirmation = prompt("경고: 이 작업은 클라우드의 모든 데이터를 덮어씁니다. 계속하려면 '복원합니다' 라고 정확히 입력해주세요.");
    if (confirmation !== '복원합니다') {
        return alert('복원 작업이 취소되었습니다.');
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            if (parsedData.transactions && parsedData.importCostSheets) {
                alert('복원을 시작합니다. 완료 메시지가 나타날 때까지 기다려주세요.');
                
                // 1. 기존 데이터 전체 삭제 (배치로 처리)
                const deleteBatch = db.batch();
                transactions.forEach(doc => deleteBatch.delete(transactionsCollection.doc(doc.id)));
                ic_costSheets.forEach(doc => deleteBatch.delete(importCostSheetsCollection.doc(doc.id)));
                await deleteBatch.commit();

                // 2. 새 데이터 전체 추가 (배치로 처리)
                const addBatch = db.batch();
                parsedData.transactions.forEach(doc => addBatch.set(transactionsCollection.doc(), doc));
                parsedData.importCostSheets.forEach(doc => addBatch.set(importCostSheetsCollection.doc(), doc));
                await addBatch.commit();

                // 3. 리스너가 자동으로 데이터를 감지하고 UI를 갱신함
                document.getElementById('backup-status').innerText = '데이터가 성공적으로 복원되었습니다.';
                alert('데이터 복원이 완료되었습니다!');
            } else {
                alert('선택된 파일이 유효한 백업 파일이 아닙니다.');
            }
        } catch (error) {
            console.error("복원 중 오류 발생:", error);
            alert('파일 처리 또는 데이터 복원 중 오류가 발생했습니다.');
        } finally {
            currentBackupFile = null; 
            document.getElementById('backup-file').value = ''; 
            document.getElementById('restore-button').disabled = true;
        }
    };
    reader.readAsText(currentBackupFile);
}


// ================== 4. UI 및 비즈니스 로직 ==================
// (이하 함수들은 대부분 변경 없음)

function updateDatalists() {
    const sets = { brand: new Set(), lot: new Set(), company: new Set() };
    transactions.forEach(t => {
        if (t.brand) sets.brand.add(t.brand);
        if (t.lot) sets.lot.add(t.lot);
        if (t.company) sets.company.add(t.company);
    });
    const toOption = item => `<option value="${item}"></option>`;
    document.getElementById('brand-list').innerHTML = [...sets.brand].sort().map(toOption).join('');
    document.getElementById('lot-list').innerHTML = [...sets.lot].sort().map(toOption).join('');
    document.getElementById('company-list-tran').innerHTML = [...sets.company].sort().map(toOption).join('');
    document.getElementById('company-list-invoice').innerHTML = [...sets.company].sort().map(toOption).join('');
}

function updateAll() {
    recalculateInventory(); 
    applyFiltersAndRender(); 
    updateDatalists();
    generateSalesReport(); 
}

function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
   
    document.getElementById('invoice-wrapper').style.display = 'none';
    document.getElementById('bill-wrapper').style.display = 'none';

    document.getElementById(tabName).classList.add('active');
    cancelTransactionEdit();
    ic_clearForm();
    if(tabName === 'sales-report') generateSalesReport();
}

const ic_pFloat = (val) => parseFloat(String(val).replace(/,/g, '')) || 0;

function toggleOtherCostsField() {
    document.getElementById('other-costs-field').style.display = 
        (document.getElementById('transaction-type').value === '출고') ? 'flex' : 'none';
    if (document.getElementById('transaction-type').value !== '출고') {
        document.getElementById('transaction-other-costs').value = '';
    }
}

function applyFiltersAndRender() {
    const invFilters = {
        brand: document.getElementById('filter-inv-brand').value.toLowerCase(),
        category: document.getElementById('filter-inv-category').value.toLowerCase(),
        spec: document.getElementById('filter-inv-spec').value.toLowerCase(),
        lot: document.getElementById('filter-inv-lot').value.toLowerCase()
    };
    const filteredInventory = inventory.filter(i => 
        i.brand.toLowerCase().includes(invFilters.brand) &&
        (i.category || '').toLowerCase().includes(invFilters.category) &&
        (i.spec || '').toLowerCase().includes(invFilters.spec) &&
        i.lot.toLowerCase().includes(invFilters.lot)
    );
    updateInventoryTable(filteredInventory);

    const tranFilters = {
        type: document.getElementById('filter-tran-type').value,
        month: document.getElementById('filter-tran-month').value,
        brand: document.getElementById('filter-tran-brand').value.toLowerCase(),
        category: document.getElementById('filter-tran-category').value.toLowerCase(),
        spec: document.getElementById('filter-tran-spec').value.toLowerCase(),
        lot: document.getElementById('filter-tran-lot').value.toLowerCase(),
        company: document.getElementById('filter-tran-company').value.toLowerCase()
    };
    const filteredTransactions = transactions.filter(t => 
        (!tranFilters.type || t.type === tranFilters.type) &&
        (!tranFilters.month || t.date.startsWith(tranFilters.month)) &&
        (t.brand?.toLowerCase().includes(tranFilters.brand)) &&
        (t.category?.toLowerCase().includes(tranFilters.category)) &&
        (t.spec?.toLowerCase().includes(tranFilters.spec)) &&
        (t.lot?.toLowerCase().includes(tranFilters.lot)) && 
        (t.company.toLowerCase().includes(tranFilters.company))
    );
    updateTransactionTable(filteredTransactions);
}

function resetInventoryFilters() {
    ['filter-inv-brand', 'filter-inv-category', 'filter-inv-spec', 'filter-inv-lot'].forEach(id => document.getElementById(id).value = '');
    applyFiltersAndRender();
}

function resetTransactionFilters() {
    ['filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-category', 'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company'].forEach(id => document.getElementById(id).value = '');
    applyFiltersAndRender();
}

function resetSalesReportFilters() {
  ['filter-sales-start-date', 'filter-sales-end-date', 'filter-sales-company', 'filter-sales-brand']
  .forEach(id => document.getElementById(id).value = '');
    generateSalesReport();
}

function recalculateInventory() {
    const tempInventoryMap = new Map();
    const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTransactions.forEach(t => {
        const itemKey = `${t.brand}_${t.category}_${t.spec}_${t.lot}`;
        if (!tempInventoryMap.has(itemKey)) {
            tempInventoryMap.set(itemKey, {
                id: itemKey, brand: t.brand, lot: t.lot, quantity: 0, category: t.category,
                spec: t.spec, costPrice: 0, receivedDate: null
            });
        }
        const currentItem = tempInventoryMap.get(itemKey);
        const weight = parseFloat(t.weight) || 0;
        
        if (t.type === '입고') {
            currentItem.quantity += weight;
            if (t.unitPrice > 0) currentItem.costPrice = t.unitPrice;
            if (t.category) currentItem.category = t.category;
            if (t.spec) currentItem.spec = t.spec;
            if (!currentItem.receivedDate || new Date(t.date) < new Date(currentItem.receivedDate)) {
                currentItem.receivedDate = t.date;
            }
        } else if (t.type === '출고') {
            currentItem.quantity -= weight;
        }
    });
    
    inventory = Array.from(tempInventoryMap.values()).map(item => {
        if (item.quantity < 0.0001) item.quantity = 0;
        return item;
    });
}

function updateInventoryTable(itemsToDisplay) {
    const tbody = document.getElementById('inventory-tbody');
    tbody.innerHTML = '';
    const totalWeight = itemsToDisplay.reduce((sum, item) => sum + item.quantity, 0);
    
    itemsToDisplay.sort((a,b)=> (a.brand+a.lot).localeCompare(b.brand+b.lot)).forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${item.brand}</td> <td>${item.category || 'N/A'}</td> <td>${item.spec || ''}</td>
            <td>${item.lot}</td> <td>${item.quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${item.receivedDate || '-'}</td>
            <td><button class="action-btn" onclick="showItemHistoryInTransactionTab('${item.brand}', '${item.category || ''}', '${item.spec || ''}', '${item.lot}')">내역 보기</button></td>`;
    });
    document.getElementById('total-inv-weight').innerText = totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showItemHistoryInTransactionTab(brand, category, spec, lot) {
    showTab('transaction');
    document.getElementById('filter-tran-brand').value = brand;
    document.getElementById('filter-tran-category').value = category;
    document.getElementById('filter-tran-spec').value = spec;
    document.getElementById('filter-tran-lot').value = lot;
    applyFiltersAndRender();
}

function updateTransactionTable(transactionsToDisplay) {
    const tbody = document.getElementById('transaction-tbody');
    tbody.innerHTML = '';
    let totalWeight = 0, totalAmount = 0, totalOtherCosts = 0;

    transactionsToDisplay.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const weight = parseFloat(t.weight) || 0;
        const unitPrice = parseFloat(t.unitPrice) || 0;
        const otherCosts = parseFloat(t.otherCosts) || 0;
        const amount = weight * unitPrice;
        
        if(t.type === '입고') totalWeight += weight; else totalWeight -= weight;
        totalAmount += amount;
        if(t.type === '출고') totalOtherCosts += otherCosts;

        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="transaction-checkbox" value="${t.id}"></td>
            <td>${t.type}</td><td>${t.date}</td><td>${t.brand || ''}</td>
            <td>${t.category || ''}</td><td>${t.spec || ''}</td><td>${t.lot || ''}</td>
            <td>${weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${unitPrice.toLocaleString('en-US')}</td>
            <td>${amount.toLocaleString('en-US')}</td>
            <td>${(t.type === '출고' ? otherCosts : 0).toLocaleString('en-US')}</td>
            <td>${t.company}</td><td>${t.notes || ''}</td><td>${t.destination || ''}</td><td>${t.specialNotes || ''}</td>`;
    });

    document.getElementById('total-tran-weight').innerText = totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('total-tran-amount').innerText = totalAmount.toLocaleString('en-US');
    document.getElementById('total-tran-other-costs').innerText = totalOtherCosts.toLocaleString('en-US');
    document.getElementById('select-all-transactions').checked = false;
}

function editSelectedTransaction() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const transaction = transactions.find(t => t.id === selectedIds[0]);
    if (!transaction) return;
    
    editingTransactionId = transaction.id;
    document.getElementById('transaction-type').value = transaction.type;
    document.getElementById('transaction-date').value = transaction.date;
    document.getElementById('tran-brand').value = transaction.brand;
    document.getElementById('tran-lot').value = transaction.lot;
    document.getElementById('tran-category').value = transaction.category || '';
    document.getElementById('tran-spec').value = transaction.spec || '';
    document.getElementById('transaction-weight').value = transaction.weight;
    document.getElementById('transaction-unit-price').value = transaction.unitPrice || '';
    document.getElementById('transaction-company').value = transaction.company;
    document.getElementById('transaction-notes').value = transaction.notes || '';
    document.getElementById('transaction-destination').value = transaction.destination || '';
    document.getElementById('transaction-special-notes').value = transaction.specialNotes || '';
    document.getElementById('transaction-other-costs').value = transaction.otherCosts || '';
    
    toggleOtherCostsField();
    document.getElementById('transaction-form-title').innerText = '입출고 수정';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processTransaction(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelTransactionEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

function cancelTransactionEdit() {
    editingTransactionId = null;
    const form = document.querySelector('#transaction .section .input-group');
    if (form) {
        Array.from(form.querySelectorAll('input, select')).forEach(input => {
            if (input.type === 'select-one') input.selectedIndex = 0;
            else if (input.id !== 'transaction-date') input.value = '';
        });
    }
    document.getElementById('transaction-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-form-title').innerText = '입출고 등록';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addTransaction()">입출고 등록</button>
        <button class="btn btn-warning" onclick="openBulkUploadModal()">대량 입출고 등록</button>`;
    toggleOtherCostsField();
}

function autoFillItemDetails() {
    if (editingTransactionId) return;
    const brand = document.getElementById('tran-brand').value.trim();
    const lot = document.getElementById('tran-lot').value.trim();
    if (!brand || !lot) return; 

    const recent = transactions.filter(t => t.brand === brand && t.lot === lot).sort((a,b) => new Date(b.date) - new Date(a.date))[0];
    if (recent) {
        document.getElementById('tran-category').value = recent.category || '';
        document.getElementById('tran-spec').value = recent.spec || '';
        if (recent.unitPrice > 0) document.getElementById('transaction-unit-price').value = recent.unitPrice;
    }
}

// ... (CSV 및 거래명세표/매출보고서/청구서 관련 함수는 대부분 변경 없음) ...
function openBulkUploadModal() {
    document.getElementById('bulkUploadModal').style.display = 'flex';
    document.getElementById('bulk-upload-status').innerText = '';
    document.getElementById('bulk-csv-file').value = '';
}

function closeBulkUploadModal() {
    document.getElementById('bulkUploadModal').style.display = 'none';
}

function downloadBulkTransactionTemplate() {
    const headers = ['거래구분(입고/출고)', '날짜(YYYY-MM-DD)*', '브랜드*', 'LOT 번호*', '중량(kg)*', '단가(원/kg)', '기타 비용', '품목 구분', '스펙 (예: 75/48)', '업체*', '비고', '도착지', '특이사항'];
    const csvContent = headers.join(',');
    downloadCSV(csvContent, '대량입출고_템플릿');
}

function processBulkUpload() {
    const file = document.getElementById('bulk-csv-file').files[0];
    if (!file) return alert('파일을 선택해주세요.');
    
    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (results) => {
            const records = results.data.map(row => ({
                type: row['거래구분(입고/출고)']?.trim() || '입고', 
                date: row['날짜(YYYY-MM-DD)*']?.trim() || '',
                brand: row['브랜드*']?.trim() || '', 
                lot: row['LOT 번호*']?.trim() || '',
                weight: parseFloat(row['중량(kg)*']) || 0, 
                unitPrice: parseFloat(row['단가(원/kg)']) || 0, 
                otherCosts: parseFloat(row['기타 비용']) || 0, 
                category: row['품목 구분']?.trim() || '',
                spec: row['스펙 (예: 75/48)']?.trim() || '', 
                company: row['업체*']?.trim() || '', 
                notes: row['비고']?.trim() || '', 
                destination: row['도착지']?.trim() || '', 
                specialNotes: row['특이사항']?.trim() || ''
            }));
            processBulkTransactions(records);
        }
    });
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportInventoryCSV() {
    const csvData = inventory.map(item => ({
        '브랜드': item.brand, '품목구분': item.category || '','스펙': item.spec || '','LOT': item.lot,
        '현재 수량(kg)': item.quantity.toFixed(2)
    }));
    downloadCSV(Papa.unparse(csvData), '재고현황');
}

function exportTransactionCSV() {
    const csvData = transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).map(t => ({
        '거래구분': t.type, '날짜': t.date, '브랜드': t.brand, '품목구분': t.category, '스펙': t.spec, 'LOT': t.lot,
        '중량(kg)': t.weight, '단가(원/kg)': t.unitPrice, '금액(원)': t.weight * t.unitPrice, 
        '기타 비용(원)': t.otherCosts || 0, '업체': t.company, '비고': t.notes, '도착지': t.destination, '특이사항': t.specialNotes
    }));
    downloadCSV(Papa.unparse(csvData), '입출고현황');
}

function exportSalesReportCSV() {
    const tbody = document.getElementById('sales-report-tbody');
    const headers = ['월', '업체', '브랜드', '품목 구분', '스펙', 'LOT', '중량(kg)', '매입 비용(원)', '기타 비용(원)', '총 비용(원)', '매출 금액(원)', '최종 마진(원)', '마진율(%)'];
    const data = Array.from(tbody.rows).map(row => {
        const cells = Array.from(row.cells);
        let rowData = {};
        headers.forEach((header, i) => { rowData[header] = cells[i].innerText; });
        return rowData;
    });
    downloadCSV(Papa.unparse(data, { header: true }), '매출보고서');
}

function generateInvoice() {
    document.getElementById('bill-wrapper').style.display = 'none';
    const recipientCompany = document.getElementById('recipient-company').value.trim();
    const startDate = document.getElementById('invoice-start-date').value;
    const endDate = document.getElementById('invoice-end-date').value;
    const transactionType = document.getElementById('invoice-transaction-type').value;
    if (!recipientCompany || !startDate || !endDate) { return alert('(*) 필수 항목(회사명, 날짜 범위)을 입력해주세요.'); }
    const filtered = transactions.filter(t => {
        return new Date(t.date) >= new Date(startDate) && new Date(t.date) <= new Date(endDate) &&
               (transactionType === 'all' || t.type === transactionType) &&
               t.company.trim().toLowerCase() === recipientCompany.toLowerCase();
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (filtered.length === 0) {
        alert('해당 조건에 맞는 거래가 없습니다.');
        document.getElementById('invoice-wrapper').style.display = 'none';
        return;
    }
    const today = new Date().toISOString().split('T')[0];
    const itemsHtml = filtered.map(t => `<tr><td>${t.date}</td> <td>${t.brand || ''}</td><td>${t.category || ''}</td><td>${t.spec || ''}</td><td>${t.lot || ''}</td><td>kg</td><td>${t.weight.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td contenteditable="true">${t.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td contenteditable="true">${t.notes || ''}</td></tr>`).join('');
    const emptyRowsHtml = Array(Math.max(0, 15 - filtered.length)).fill('<tr><td colspan="9" style="height: 25px;">&nbsp;</td></tr>').join('');

    document.getElementById('invoice-content').innerHTML = `
        <div class="invoice-header"><h2 class="invoice-title">거래명세표</h2></div>
        <div class="invoice-info">
            <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>자</td><td class="label-td">사업자번호</td><td>101-02-35223</td></tr><tr><td class="label-td">상호</td><td>그루텍스</td></tr><tr><td class="label-td">주소</td><td>서울시 도봉구 노해로 397-15 백상빌딩 1005호</td></tr></table></div>
            <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>받<br>는<br>자</td><td class="label-td">사업자번호</td><td contenteditable="true">${document.getElementById('recipient-reg-no').value}</td></tr><tr><td class="label-td">상호</td><td contenteditable="true">${recipientCompany}</td></tr><tr><td class="label-td">주소</td><td contenteditable="true">${document.getElementById('recipient-address').value}</td></tr></table></div>
        </div>
        <div class="invoice-items"><table><thead><tr><th colspan="9" style="text-align:left; padding-left:10px;">작성일자: ${today}</th></tr> <tr><th>날짜</th><th>브랜드</th><th>품목</th><th>스펙</th><th>LOT</th><th>단위</th><th>수량</th><th>단가</th><th>비고</th></tr> </thead><tbody>${itemsHtml}${emptyRowsHtml}</tbody></table></div>
        <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">도착지</td><td contenteditable="true" style="text-align:left; padding-left:10px;">${filtered.length > 0 ? filtered[0].destination : ''}</td></tr></table></div>
        <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">비 고</td><td contenteditable="true" style="height: 80px; text-align:left; vertical-align:top; padding: 5px;"></td></tr></table></div>
        <div class="invoice-company-info" style="margin-top: 30px; padding: 15px; border-top: 2px solid #333; text-align: center;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin-bottom: 10px;"><span style="font-size: 18px; font-weight: bold; letter-spacing: 3px;">그루텍스</span><span style="font-size: 16px; margin-left: 10px;">| GROOOTEX</span></div><div style="font-size: 11px; color: #333; line-height: 1.4;"><p style="font-weight: bold; margin-bottom: 5px;">#1002, 10F, Backsang building, 397-15, Nohae-ro, Dobong-gu, Seoul, Korea (01415)</p><p>Tel: 82 2 997 8566  Fax: 82 2 997 4888  e-mail: groootex@groootex.com</p></div></div>`;
    document.getElementById('invoice-wrapper').style.display = 'block';
}

function printInvoice() { window.print(); }

function saveInvoiceAsPDF() {
    html2pdf(document.getElementById('invoice-content'), {
        margin: 10, filename: '거래명세표.pdf', image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });
}

function generateSalesReport() {
   const startDate = document.getElementById('filter-sales-start-date').value;
   const endDate = document.getElementById('filter-sales-end-date').value;
   const companyFilter = document.getElementById('filter-sales-company').value.toLowerCase();
   const brandFilter = document.getElementById('filter-sales-brand').value.toLowerCase();
    
   const outgoingTransactions = transactions.filter(t => {
        const transactionDate = new Date(t.date);
        const startCheck = !startDate || transactionDate >= new Date(startDate);
        const endCheck = !endDate || transactionDate <= new Date(endDate);
        return t.type === '출고' && startCheck && endCheck &&
            (!companyFilter || t.company.toLowerCase().includes(companyFilter)) &&
            (!brandFilter || t.brand.toLowerCase().includes(brandFilter));
    });

    const tbody = document.getElementById('sales-report-tbody');
    tbody.innerHTML = '';
    let totalWeight = 0, totalSalesAmount = 0, totalCostOfGoods = 0, totalOtherCosts = 0;
    
    outgoingTransactions.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const matchingInbound = transactions.filter(it => 
            it.type === '입고' &&
            it.brand.toLowerCase() === t.brand.toLowerCase() &&
            it.lot.toLowerCase() === t.lot.toLowerCase() &&
            (it.category || '').toLowerCase() === (t.category || '').toLowerCase() &&
            (it.spec || '').toLowerCase() === (t.spec || '').toLowerCase()
        ).sort((a,b) => new Date(b.date) - new Date(a.date));

        const costPrice = matchingInbound.length > 0 ? matchingInbound[0].unitPrice : 0;
        
        const salesAmount = t.weight * t.unitPrice;
        const costOfGoods = t.weight * costPrice;
        const totalCosts = costOfGoods + (t.otherCosts || 0);
        const margin = salesAmount - totalCosts;
        const marginRate = salesAmount !== 0 ? (margin / salesAmount * 100).toFixed(2) : 0;
        
        totalWeight += t.weight;
        totalSalesAmount += salesAmount;
        totalCostOfGoods += costOfGoods;
        totalOtherCosts += t.otherCosts || 0;

        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${t.date.substring(0, 7)}</td><td>${t.company}</td><td>${t.brand}</td><td>${t.category}</td>
            <td>${t.spec}</td><td>${t.lot}</td><td>${t.weight.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${costOfGoods.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${(t.otherCosts || 0).toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${totalCosts.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${salesAmount.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${margin.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${marginRate}%</td>`;
    });

    const totalTotalCosts = totalCostOfGoods + totalOtherCosts;
    const totalMargin = totalSalesAmount - totalTotalCosts;
    const totalMarginRate = totalSalesAmount !== 0 ? (totalMargin / totalSalesAmount * 100).toFixed(2) : '0.00';

    document.getElementById('total-sales-weight').innerText = totalWeight.toLocaleString(undefined, {maximumFractionDigits:2});
    document.getElementById('total-sales-cost-of-goods').innerText = totalCostOfGoods.toLocaleString(undefined, {maximumFractionDigits:2});
    document.getElementById('total-sales-other-costs').innerText = totalOtherCosts.toLocaleString(undefined, {maximumFractionDigits:2});
    document.getElementById('total-sales-total-costs').innerText = totalTotalCosts.toLocaleString(undefined, {maximumFractionDigits:2});
    document.getElementById('total-sales-amount').innerText = totalSalesAmount.toLocaleString(undefined, {maximumFractionDigits:2});
    document.getElementById('total-sales-margin').innerText = totalMargin.toLocaleString(undefined, {maximumFractionDigits:2});
    document.getElementById('total-sales-margin-rate').innerText = `${totalMarginRate}%`;
}
        
function toggleAllCheckboxes(className, checked) {
    document.querySelectorAll(`.${className}`).forEach(checkbox => checkbox.checked = checked);
}

// ... (이하 수입원가 및 청구서 관련 함수는 이전 답변과 동일하게 유지) ...
// ================== 수입원가 정산서 스크립트 (ic_ 함수) ==================
function ic_formatInputForDisplay(input) {
    const value = ic_pFloat(input.value);
    if (!isNaN(value) && input.value.trim() !== '') {
        input.value = value.toLocaleString('en-US', { maximumFractionDigits: 10 });
    }
}

function ic_addItemRow() {
    const tbody = document.getElementById('item-tbody');
    const newRow = tbody.insertRow();
    newRow.innerHTML = `
        <td><input type="text" class="item-name" placeholder="품목" oninput="ic_calculateAll()"></td>
        <td><input type="text" class="item-lot" placeholder="LOT" oninput="ic_calculateAll()"></td>
        <td><input type="text" class="item-qty" placeholder="수량" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td>
        <td><input type="text" class="item-unit" placeholder="단위 (ex: kg)" oninput="ic_calculateAll()"></td>
        <td><input type="text" class="item-price" placeholder="단가 ($)" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td>
        <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); ic_calculateAll();">-</button></td>
    `;
}

function ic_clearForm() {
    ic_editingId = null;
    document.getElementById('ic-cost-form').reset();
    document.getElementById('item-tbody').innerHTML = '';
    document.getElementById('result-tbody').innerHTML = '';
    document.getElementById('total-invoice-value').textContent = '$0.00';
    ic_addItemRow();
    document.getElementById('ic-form-title').textContent = '수입 정산 등록';
    document.getElementById('ic-submit-btn').textContent = '정산서 등록';
    document.getElementById('ic-submit-btn').onclick = ic_addCostSheet;
    document.getElementById('ic-cancel-btn').style.display = 'none';
}

function ic_resetFilters() {
    document.getElementById('filter-ic-start-date').value = '';
    document.getElementById('filter-ic-end-date').value = '';
    document.getElementById('filter-shipper').value = '';
    document.getElementById('filter-item').value = '';
    document.getElementById('filter-lot').value = '';
    ic_renderList();
}

function ic_calculateAll() {
    let totalInvoiceValue = 0;
    const items = [];
    document.querySelectorAll('#item-tbody tr').forEach(row => {
        const item = {
            name: row.querySelector('.item-name').value.trim(), lot: row.querySelector('.item-lot').value.trim(),
            qty: ic_pFloat(row.querySelector('.item-qty').value), unit: row.querySelector('.item-unit').value.trim(),
            price: ic_pFloat(row.querySelector('.item-price').value),
        };
        totalInvoiceValue += item.qty * item.price;
        items.push(item);
    });
    document.getElementById('total-invoice-value').textContent = '$' + totalInvoiceValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const exchangeRate = ic_pFloat(document.getElementById('form-exchange-rate').value);
    const shippingFee = ic_pFloat(document.getElementById('form-shipping-fee').value);
    const tariffRate = ic_pFloat(document.getElementById('form-tariff-rate').value) / 100;
    const tariffAmount = ic_pFloat(document.getElementById('form-tariff-amount').value);
    const fFee1 = ic_pFloat(document.getElementById('form-forwarder-fee1').value);
    const fFee2 = ic_pFloat(document.getElementById('form-forwarder-fee2').value);
    const fFee3 = ic_pFloat(document.getElementById('form-forwarder-fee3').value);

    const invoiceKrw = totalInvoiceValue * exchangeRate;
    const totalMaterialCost = invoiceKrw + shippingFee;
    const tariffCost = tariffAmount > 0 ? tariffAmount : invoiceKrw * tariffRate;
    const totalForwarderFee = fFee1 + fFee2 + fFee3;
    const grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;
    
    const resultTbody = document.getElementById('result-tbody');
    resultTbody.innerHTML = '';
    items.forEach(item => {
        let unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
        const newRow = resultTbody.insertRow();
        newRow.innerHTML = `
            <td>${item.name || 'N/A'}</td> <td>${item.lot || 'N/A'}</td> <td>${item.qty.toLocaleString()}</td>
            <td>${item.unit || 'N/A'}</td> <td>$${(item.qty * item.price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td class="highlight calculated-field">₩${Math.round(unitCost).toLocaleString()}</td>`;
    });
}

function ic_renderList() {
    const tbody = document.getElementById('cost-list-tbody');
    tbody.innerHTML = '';
   const filterStartDate = document.getElementById('filter-ic-start-date').value;
   const filterEndDate = document.getElementById('filter-ic-end-date').value;
   const filterShipper = document.getElementById('filter-shipper').value.toLowerCase();
    const filterItem = document.getElementById('filter-item').value.toLowerCase();
    const filterLot = document.getElementById('filter-lot').value.toLowerCase();

 const filtered = ic_costSheets.filter(sheet => {
 const etdDate = sheet.etd ? new Date(sheet.etd) : null;
 const startCheck = !filterStartDate || (etdDate && etdDate >= new Date(filterStartDate));
 const endCheck = !filterEndDate || (etdDate && etdDate <= new Date(filterEndDate));

 return startCheck && endCheck &&
 sheet.shipper.toLowerCase().includes(filterShipper) &&
     (!filterItem || sheet.items.some(item => (item.name || item.itemName).toLowerCase().includes(filterItem))) &&
     (!filterLot || sheet.items.some(item => item.lot.toLowerCase().includes(filterLot)));
}).sort((a,b) => (b.etd || '').localeCompare(a.etd || ''));

    filtered.forEach(sheet => {
        const itemCount = sheet.items.length;
        sheet.items.forEach((item, index) => {
            const row = tbody.insertRow();
            if (index === 0) {
                row.innerHTML = `<td rowspan="${itemCount}" style="text-align:center;"><input type="checkbox" class="sheet-checkbox" value="${sheet.id}"></td>
                                 <td rowspan="${itemCount}">${sheet.eta || ''}</td> <td rowspan="${itemCount}">${sheet.shipper}</td>`;
            }
            row.innerHTML += `<td>${item.name || item.itemName}</td><td>${item.lot}</td><td>${(item.qty || item.quantity || 0).toLocaleString()} ${item.unit}</td>
                             <td>$${(item.price || item.unitPrice || 0).toLocaleString()}</td><td>${sheet.terms}</td> <td>${sheet.origin}</td>
                             <td>${sheet.method}</td><td>${sheet.cbm}</td> <td>${sheet.packing || sheet.packaging || ''}</td>
                             <td>${sheet.tariffRate || sheet.customsRate || 0}%</td><td>${ic_pFloat(sheet.exchangeRate).toLocaleString()}</td>
                             <td class="highlight">₩${Math.round(item.unitCost || 0).toLocaleString()}</td>`;
        });
    });
}

function ic_editSelectedSheet() {
    const selectedIds = Array.from(document.querySelectorAll('.sheet-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) { return alert('수정할 항목을 하나만 선택하세요.'); }
    const sheet = ic_costSheets.find(s => s.id === selectedIds[0]);
    if (!sheet) return;
    
    ic_editingId = sheet.id;
    
    document.getElementById('form-shipper').value = sheet.shipper || '';
    document.getElementById('form-terms').value = sheet.terms || '';
    document.getElementById('form-origin').value = sheet.origin || '';
    document.getElementById('form-method').value = sheet.method || '';
    document.getElementById('form-etd').value = sheet.etd || '';
    document.getElementById('form-eta').value = sheet.eta || '';
    document.getElementById('form-cbm').value = sheet.cbm || '';
    document.getElementById('form-packing').value = sheet.packing || sheet.packaging || '';
    
    document.getElementById('form-exchange-rate').value = sheet.exchangeRate || '';
    document.getElementById('form-shipping-fee').value = sheet.shippingFee || sheet.bankFee || '';
    document.getElementById('form-tariff-rate').value = sheet.tariffRate || sheet.customsRate || '';
    document.getElementById('form-tariff-amount').value = sheet.tariffAmount || sheet.customsDuty || '';
    document.getElementById('form-vat-amount').value = sheet.vatAmount || sheet.vat || '';
    document.getElementById('form-forwarder-fee1').value = sheet.forwarderFee1 || sheet.localTotalCost || '';
    document.getElementById('form-forwarder-fee2').value = sheet.forwarderFee2 || sheet.importTotalCost || '';
    document.getElementById('form-forwarder-fee3').value = sheet.forwarderFee3 || sheet.localDeliveryFee || '';

    const itemTbody = document.getElementById('item-tbody');
    itemTbody.innerHTML = '';
    sheet.items.forEach(item => {
        const newRow = itemTbody.insertRow();
        newRow.innerHTML = `
            <td><input type="text" class="item-name" value="${item.name || item.itemName}" oninput="ic_calculateAll()"></td>
            <td><input type="text" class="item-lot" value="${item.lot}" oninput="ic_calculateAll()"></td>
            <td><input type="text" class="item-qty" value="${(item.qty || item.quantity || 0)}" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td>
            <td><input type="text" class="item-unit" value="${item.unit}" oninput="ic_calculateAll()"></td>
            <td><input type="text" class="item-price" value="${(item.price || item.unitPrice || 0)}" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td>
            <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); ic_calculateAll();">-</button></td>`;
    });

    ['form-exchange-rate', 'form-shipping-fee', 'form-tariff-amount', 'form-vat-amount', 'form-forwarder-fee1', 'form-forwarder-fee2', 'form-forwarder-fee3'].forEach(id => {
        ic_formatInputForDisplay(document.getElementById(id));
    });
    document.querySelectorAll('.item-qty, .item-price').forEach(input => ic_formatInputForDisplay(input));

    ic_calculateAll();
    document.getElementById('ic-form-title').textContent = '수입 정산 수정';
    document.getElementById('ic-submit-btn').textContent = '수정 저장';
    document.getElementById('ic-submit-btn').onclick = () => ic_processCostSheet(true);
    document.getElementById('ic-cancel-btn').style.display = 'inline-block';
    window.scrollTo(0, 0);
}

function ic_toggleAllListCheckboxes(checked) {
    document.querySelectorAll('.sheet-checkbox').forEach(cb => cb.checked = checked);
}
function ic_printForm() { window.print(); }

function ic_exportListToCsv() {
    const csvData = [];
    ic_costSheets.forEach(sheet => {
        sheet.items.forEach(item => {
            csvData.push({
                "ETA": sheet.eta, "Shipper": sheet.shipper, "품목": item.name || item.itemName, "LOT": item.lot,
                "수량 (단위)": `${item.qty || item.quantity} ${item.unit}`, "단가($)": item.price || item.unitPrice, "Terms": sheet.terms, "C/O": sheet.origin,
                "Method": sheet.method, "CBM": sheet.cbm, "포장": sheet.packing || sheet.packaging, "관세(%)": sheet.tariffRate || sheet.customsRate,
                "환율": sheet.exchangeRate, "수입원가(원)": Math.round(item.unitCost || 0)
            });
        });
    });
    downloadCSV(Papa.unparse(csvData), `수입정산내역_${new Date().toISOString().slice(0,10)}`);
}

function ic_openBulkUploadModal() {
    const modal = document.getElementById('ic_bulkUploadModal'); 
    const uploadBtn = document.getElementById('ic_bulk-upload-process-btn');
    const form = document.getElementById('ic_bulk-upload-form');
    const statusDiv = document.getElementById('ic_bulk-upload-status');

    if (modal) modal.style.display = 'flex';
    if (form) form.reset();
    if (uploadBtn) uploadBtn.disabled = true;
    if (statusDiv) statusDiv.innerHTML = '';
}

function ic_closeBulkUploadModal() {
    const modal = document.getElementById('ic_bulkUploadModal');
    if (modal) modal.style.display = 'none';
}

function ic_downloadBulkTemplate() {
    const headers = [
        "그룹ID*", "Shipper*", "ETD*(YYYY-MM-DD)", "ETA(YYYY-MM-DD)", "적용환율*", "Terms", "Origin", "Method", "CBM", "포장",
        "은행 송금수수료(원)", "관세율(%)", "관세(원)", "부가가치세(원)", "현지 내륙 총 비용(원)", "수입 총 비용(원)", "국내 내륙 운송비(원)",
        "품목*", "LOT*", "수량*", "단위", "단가($)*"
    ];
    const csvContent = headers.join(',') + '\r\n';
    downloadCSV(csvContent, '수입정산서_일괄등록_템플릿');
}

function ic_processBulkUpload() {
    const fileInput = document.getElementById('ic_bulk-csv-file');
    const statusDiv = document.getElementById('ic_bulk-upload-status');
    const file = fileInput.files[0];

    if (!file) {
        statusDiv.innerHTML = `<p class="error">파일을 선택해주세요.</p>`;
        return;
    }
    statusDiv.innerHTML = '<p>CSV 파일을 처리 중입니다...</p>';
    const parseNumber = (value) => {
        if (typeof value !== 'string') return isNaN(parseFloat(value)) ? 0 : parseFloat(value);
        const cleanedValue = value.replace(/,/g, '').trim();
        return cleanedValue === '' ? 0 : parseFloat(cleanedValue);
    };

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            statusDiv.innerHTML = '<p>데이터를 검증하고 Firestore에 저장 중입니다...</p>';
            const data = results.data;
            const requiredFields = ['그룹ID*', 'Shipper*', 'ETD*(YYYY-MM-DD)', '적용환율*', '품목*', 'LOT*', '수량*', '단가($)*'];
            
            let errorMessages = [];
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const missingFields = requiredFields.filter(field => !row[field] || String(row[field]).trim() === '');
                if (missingFields.length > 0) {
                    errorMessages.push(`${i + 2}번째 줄에 필수 항목(${missingFields.join(', ')})이 비어있습니다.`);
                }
            }

            if (errorMessages.length > 0) {
                statusDiv.innerHTML = `<p class="error"><strong>오류:</strong><br>${errorMessages.join('<br>')}</p>`;
                return;
            }

            const sheetsByGroup = data.reduce((acc, row) => {
                const groupId = String(row['그룹ID*']).trim();
                if (!acc[groupId]) {
                    acc[groupId] = {
                        id: groupId,
                        shipper: row['Shipper*'],
                        etd: row['ETD*(YYYY-MM-DD)'],
                        eta: row['ETA(YYYY-MM-DD)'] || '',
                        exchangeRate: parseNumber(row['적용환율*']),
                        terms: row['Terms'] || '',
                        origin: row['Origin'] || '',
                        method: row['Method'] || '',
                        cbm: parseNumber(row['CBM']),
                        packaging: row['포장'] || '',
                        bankFee: parseNumber(row['은행 송금수수료(원)']),
                        customsRate: parseNumber(row['관세율(%)']),
                        customsDuty: parseNumber(row['관세(원)']),
                        vat: parseNumber(row['부가가치세(원)']),
                        localTotalCost: parseNumber(row['현지 내륙 총 비용(원)']),
                        importTotalCost: parseNumber(row['수입 총 비용(원)']),
                        localDeliveryFee: parseNumber(row['국내 내륙 운송비(원)']),
                        createdAt: new Date().toISOString(),
                        items: []
                    };
                }
                acc[groupId].items.push({
                    itemName: row['품목*'],
                    lot: row['LOT*'],
                    quantity: parseNumber(row['수량*']),
                    unit: row['단위'] || 'kg',
                    unitPrice: parseNumber(row['단가($)*']),
                });
                return acc;
            }, {});

            Object.values(sheetsByGroup).forEach(sheet => {
                const totalInvoiceValueUSD = sheet.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
                const totalFeesKRW = sheet.bankFee + sheet.customsDuty + sheet.localTotalCost + sheet.importTotalCost + sheet.localDeliveryFee;
                sheet.items.forEach(item => {
                    const baseUnitCostKRW = item.unitPrice * sheet.exchangeRate;
                    let allocatedFeePerUnit = 0;
                    if (totalInvoiceValueUSD > 0 && item.quantity > 0) {
                        const itemValueRatio = (item.quantity * item.unitPrice) / totalInvoiceValueUSD;
                        const allocatedFeesForItem = totalFeesKRW * itemValueRatio;
                        allocatedFeePerUnit = allocatedFeesForItem / item.quantity;
                    }
                    item.unitCost = baseUnitCostKRW + allocatedFeePerUnit;
                });
            });

            try {
                const batch = db.batch();
                const sheetArray = Object.values(sheetsByGroup);

                sheetArray.forEach(sheetData => {
                    const docRef = importCostSheetsCollection.doc(sheetData.id);
                    batch.set(docRef, sheetData);
                });
                await batch.commit();
                
                statusDiv.innerHTML = `<p class="success">${sheetArray.length}개의 정산서 그룹이 성공적으로 등록되었습니다!</p>`;
                setTimeout(ic_closeBulkUploadModal, 2000);

            } catch (error) {
                console.error("Firestore 저장 실패:", error);
                statusDiv.innerHTML = `<p class="error">데이터베이스 저장 중 오류가 발생했습니다: ${error.message}</p>`;
            }
        },
        error: (err) => {
            statusDiv.innerHTML = `<p class="error">CSV 파일 파싱 중 오류 발생: ${err.message}</p>`;
        }
    });
}

// ================== 4-1. 청구서 관련 기능 ==================
function calculateRowAndTotal(cellElement) {
    const row = cellElement.closest('tr');
    if (!row) return;
    const quantity = parseFloat(row.cells[6].innerText.replace(/,/g, '')) || 0;
    const unitPrice = parseFloat(row.cells[7].innerText.replace(/,/g, '')) || 0;
    const subtotal = quantity * unitPrice;
    row.cells[8].innerText = Math.round(subtotal).toLocaleString();
    calculateBillTotals();
}

function calculateBillTotals() {
    const tbody = document.querySelector('#bill-items-table tbody');
    if (!tbody) return;
    let subtotal = 0;
    tbody.querySelectorAll('tr').forEach(row => {
        const rowTotal = parseFloat(row.cells[8].innerText.replace(/,/g, '')) || 0;
        subtotal += rowTotal;
    });
    const vat = subtotal * 0.1;
    const total = subtotal + vat;
    document.getElementById('bill-subtotal').innerText = Math.round(subtotal).toLocaleString();
    document.getElementById('bill-vat').innerText = Math.round(vat).toLocaleString();
    document.getElementById('bill-total').innerText = Math.round(total).toLocaleString();
}

function addBillItemRow() {
    const tbody = document.querySelector('#bill-items-table tbody');
    if (!tbody) return;
    const newRow = tbody.insertRow();
    newRow.innerHTML = `
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true"></td>
        <td contenteditable="true">kg</td>
        <td contenteditable="true" oninput="calculateRowAndTotal(this)">0</td>
        <td contenteditable="true" oninput="calculateRowAndTotal(this)">0</td>
        <td class="row-total">0</td>
        <td contenteditable="true"></td>
        <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calculateBillTotals();">삭제</button></td>
    `;
}

function generateBill() {
    document.getElementById('invoice-wrapper').style.display = 'none';
    const recipientCompany = document.getElementById('recipient-company').value.trim();
    const startDate = document.getElementById('invoice-start-date').value;
    const endDate = document.getElementById('invoice-end-date').value;
    
    if (!recipientCompany || !startDate || !endDate) {
        return alert('(*) 필수 항목(회사명, 날짜 범위)을 입력해주세요.');
    }
    
    const filtered = transactions.filter(t => {
        return new Date(t.date) >= new Date(startDate) && new Date(t.date) <= new Date(endDate) &&
               t.type === '출고' &&
               t.company.trim().toLowerCase() === recipientCompany.toLowerCase();
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    const itemsHtml = filtered.map(t => {
        const subtotal = t.weight * t.unitPrice;
        return `
        <tr>
            <td contenteditable="true">${t.date}</td>
            <td contenteditable="true">${t.brand || ''}</td>
            <td contenteditable="true">${t.category || ''}</td>
            <td contenteditable="true">${t.spec || ''}</td>
            <td contenteditable="true">${t.lot || ''}</td>
            <td contenteditable="true">kg</td>
            <td contenteditable="true" oninput="calculateRowAndTotal(this)">${t.weight.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td contenteditable="true" oninput="calculateRowAndTotal(this)">${t.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td class="row-total">${Math.round(subtotal).toLocaleString()}</td>
            <td contenteditable="true">${t.notes || ''}</td>
            <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calculateBillTotals();">삭제</button></td>
        </tr>
    `}).join('');
    
    const billWrapper = document.getElementById('bill-wrapper');
    billWrapper.innerHTML = `
        <div id="bill-controls">
             <button class="btn btn-success" onclick="addBillItemRow()">항목 추가</button>
             <button class="btn btn-primary" onclick="printBill()">인쇄</button>
             <button class="btn btn-info" onclick="saveBillAsPDF()">PDF로 저장</button>
        </div>
        <div id="bill-content" class="invoice">
            <div class="invoice-header"><h2 class="invoice-title">청 구 서</h2></div>
            <div class="invoice-info">
                <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>자</td><td class="label-td">사업자번호</td><td>101-02-35223</td></tr><tr><td class="label-td">상호</td><td>그루텍스</td></tr><tr><td class="label-td">주소</td><td>서울시 도봉구 노해로 397-15 백상빌딩 1005호</td></tr></table></div>
                <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>받<br>는<br>자</td><td class="label-td">사업자번호</td><td contenteditable="true">${document.getElementById('recipient-reg-no').value}</td></tr><tr><td class="label-td">상호</td><td contenteditable="true">${recipientCompany}</td></tr><tr><td class="label-td">주소</td><td contenteditable="true">${document.getElementById('recipient-address').value}</td></tr></table></div>
            </div>
            <div class="invoice-items">
                <table id="bill-items-table">
                    <thead>
                        <tr>
                            <th>날짜</th><th>브랜드</th><th>품목</th><th>스펙</th><th>LOT</th><th>단위</th><th>수량</th><th>단가</th><th>합계</th><th>비고</th><th style="width: 60px;">관리</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="9" style="text-align: right; font-weight: bold;">공급가액 (합계)</td>
                            <td colspan="2" id="bill-subtotal" style="text-align: right; font-weight: bold;">0</td>
                        </tr>
                        <tr>
                            <td colspan="9" style="text-align: right; font-weight: bold;">부가가치세 (VAT)</td>
                            <td colspan="2" id="bill-vat" style="text-align: right; font-weight: bold;">0</td>
                        </tr>
                        <tr>
                            <td colspan="9" style="text-align: right; font-weight: bold; background-color: #f2f2f2;">총 청구금액</td>
                            <td colspan="2" id="bill-total" style="text-align: right; font-weight: bold; background-color: #f2f2f2;">0</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">비 고</td><td contenteditable="true" style="height: 80px; text-align:left; vertical-align:top; padding: 5px;">* 입금 계좌 </td>
  하나은행 / 이선용(그루텍스) 221-890021-4840</td></tr></table></div>
            <div class="invoice-company-info" style="margin-top: 30px; padding: 15px; border-top: 2px solid #333; text-align: center;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin-bottom: 10px;"><span style="font-size: 18px; font-weight: bold; letter-spacing: 3px;">그루텍스</span><span style="font-size: 16px; margin-left: 10px;">| GROOOTEX</span></div><div style="font-size: 11px; color: #333; line-height: 1.4;"><p style="font-weight: bold; margin-bottom: 5px;">#1002, 10F, Backsang building, 397-15, Nohae-ro, Dobong-gu, Seoul, Korea (01415)</p><p>Tel: 82 2 997 8566  Fax: 82 2 997 4888  e-mail: groootex@groootex.com</p></div></div>
        </div>
    `;
    
    document.getElementById('bill-wrapper').style.display = 'block';
    calculateBillTotals(); 
}

function printBill() {
    window.print();
}

function saveBillAsPDF() {
    html2pdf(document.getElementById('bill-content'), {
        margin: 10, filename: '청구서.pdf', image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });
}

// ================== 5. HTML onclick과 함수 연결 ==================
window.showTab = showTab;
window.toggleOtherCostsField = toggleOtherCostsField;
window.addTransaction = () => processTransaction(false);
window.openBulkUploadModal = openBulkUploadModal;
window.resetTransactionFilters = resetTransactionFilters;
window.editSelectedTransaction = editSelectedTransaction;
window.deleteSelectedTransactions = deleteSelectedTransactions;
window.exportTransactionCSV = exportTransactionCSV;
window.toggleAllCheckboxes = toggleAllCheckboxes;
window.processBulkUpload = processBulkUpload;
window.closeBulkUploadModal = closeBulkUploadModal;
window.downloadBulkTransactionTemplate = downloadBulkTransactionTemplate;
window.cancelTransactionEdit = cancelTransactionEdit;
window.resetInventoryFilters = resetInventoryFilters;
window.exportInventoryCSV = exportInventoryCSV;
window.showItemHistoryInTransactionTab = showItemHistoryInTransactionTab;
window.generateInvoice = generateInvoice;
window.printInvoice = printInvoice;
window.saveInvoiceAsPDF = saveInvoiceAsPDF;
window.generateBill = generateBill;
window.addBillItemRow = addBillItemRow;
window.printBill = printBill;
window.saveBillAsPDF = saveBillAsPDF;
window.generateSalesReport = generateSalesReport;
window.resetSalesReportFilters = resetSalesReportFilters;
window.exportSalesReportCSV = exportSalesReportCSV;
window.ic_addItemRow = ic_addItemRow;
window.ic_calculateAll = ic_calculateAll;
window.ic_formatInputForDisplay = ic_formatInputForDisplay;
window.ic_printForm = ic_printForm;
window.ic_openBulkUploadModal = ic_openBulkUploadModal;
window.ic_addCostSheet = () => ic_processCostSheet(false);
window.ic_clearForm = ic_clearForm;
window.ic_renderList = ic_renderList;
window.ic_resetFilters = ic_resetFilters;
window.ic_exportListToCsv = ic_exportListToCsv;
window.ic_editSelectedSheet = ic_editSelectedSheet;
window.ic_deleteSelectedSheets = ic_deleteSelectedSheets;
window.ic_toggleAllListCheckboxes = ic_toggleAllListCheckboxes;
window.ic_closeBulkUploadModal = ic_closeBulkUploadModal;
window.ic_downloadBulkTemplate = ic_downloadBulkTemplate;
window.ic_processBulkUpload = ic_processBulkUpload;
window.backupDataToJson = backupDataToJson;
window.restoreDataFromJson = restoreDataFromJson;
window.loadBackupFile = loadBackupFile;
window.calculateRowAndTotal = calculateRowAndTotal;
window.calculateBillTotals = calculateBillTotals;
