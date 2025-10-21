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
const salesCollection = db.collection('sales');
const remittancesCollection = db.collection('remittances');

// 전역 변수
let inventory = [];
let transactions = [];
let sales = [];
let remittances = [];
let ic_costSheets = [];
let editingTransactionId = null;
let editingSaleId = null;
let editingRemittanceId = null;
let ic_editingId = null;
// START: CSV 전역 변수 추가
let salesCsvData = null; // 매출 CSV 데이터 저장용
let remitCsvData = null; // 해외송금 CSV 데이터 저장용
// END: CSV 전역 변수 추가
let currentBackupFile = null;
// [추가] 대시보드 차트 인스턴스
let dashboardChart = null;

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
        loadAllDataFromFirebase();
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


// --- loadAllDataFromFirebase 함수 수정 ---
function loadAllDataFromFirebase() {
    console.log("Firestore에서 실시간 데이터 동기화를 시작합니다...");

    transactionsCollection.onSnapshot(snapshot => {
        if (editingTransactionId) {
            const stillExists = snapshot.docs.some(doc => doc.id === editingTransactionId);
            if (!stillExists) {
                alert('현재 수정하던 항목이 다른 곳에서 삭제되어 수정 모드를 안전하게 취소합니다.');
                cancelTransactionEdit();
            }
        }
        transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return { ...data, id: doc.id, product: data.product || data.category || '' };
        });
        console.log(`입출고 데이터 실시간 업데이트됨. 총 ${transactions.length}건`);
        updateAll();
        updateDashboard(); // [추가]
    }, error => console.error("입출고 내역 실시간 동기화 오류:", error));

    importCostSheetsCollection.onSnapshot(snapshot => {
        ic_costSheets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        console.log(`수입원가 데이터 실시간 업데이트됨. 총 ${ic_costSheets.length}건`);
        ic_renderList();
    }, error => console.error("수입원가 정산서 실시간 동기화 오류:", error));

    salesCollection.onSnapshot(snapshot => {
        sales = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        console.log(`매출 데이터 실시간 업데이트됨. 총 ${sales.length}건`);
        applySalesFiltersAndRender();
        generateSalesReport();
        updateDashboard(); // [추가]
    }, error => console.error("매출 내역 실시간 동기화 오류:", error));

    remittancesCollection.onSnapshot(snapshot => {
        remittances = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        console.log(`해외송금 데이터 실시간 업데이트됨. 총 ${remittances.length}건`);
        applyRemittanceFiltersAndRender();
    }, error => console.error("해외송금 내역 실시간 동기화 오류:", error));

    initializeAppUI();
}

// --- initializeAppUI 함수 수정 ---
function initializeAppUI() {
    console.log("UI 초기화를 시작합니다...");
    const today = new Date().toISOString().slice(0, 10);
    ['transaction-date', 'sales-date', 'remit-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
    });
    
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    document.getElementById('invoice-start-date').value = firstDayOfMonth;
    document.getElementById('invoice-end-date').value = today;
    
    // [추가] 대시보드 년도 필터 초기화
    const yearFilter = document.getElementById('dashboard-year-filter');
    if (yearFilter) {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear + 1; i >= 2023; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.text = `${i}년`;
            yearFilter.add(option);
        }
        yearFilter.value = currentYear;
    }

    bindEventListeners();
    ic_addItemRow();
    updateDashboard(); // [추가]
    console.log("UI 초기화 완료.");
}

// --- bindEventListeners 함수 수정 ---
function bindEventListeners() {
    ['filter-inv-brand', 'filter-inv-product', 'filter-inv-spec', 'filter-inv-lot', 
     'filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-product', 
     'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applyFiltersAndRender));

    ['filter-report-start-date', 'filter-report-end-date', 'filter-report-company', 'filter-report-brand', 'filter-report-item-category', 'filter-report-product', 'filter-report-spec']
    .forEach(id => document.getElementById(id)?.addEventListener('input', generateSalesReport));
  
    ['filter-sales-start-month', 'filter-sales-end-month', 'filter-sales-list-company', 'filter-sales-list-brand', 'filter-sales-list-item-category', 'filter-sales-list-product', 'filter-sales-list-spec']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applySalesFiltersAndRender));

    ['filter-remit-start-month', 'filter-remit-end-month', 'filter-remit-company', 'filter-remit-brand', 'filter-remit-item-category', 'filter-remit-product', 'filter-remit-spec']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applyRemittanceFiltersAndRender));

    // [추가] 대시보드 년도 필터 이벤트 리스너
    document.getElementById('dashboard-year-filter')?.addEventListener('change', updateDashboard);

    document.getElementById('tran-brand').addEventListener('blur', autoFillItemDetails);
    document.getElementById('tran-lot').addEventListener('blur', autoFillItemDetails);

// START: CSV 파일 입력 이벤트 리스너 추가
const salesCsvEl = document.getElementById('sales-csv-file');
if (salesCsvEl) salesCsvEl.addEventListener('change', handleSalesCsvUpload);
const remitCsvEl = document.getElementById('remit-csv-file');
if (remitCsvEl) remitCsvEl.addEventListener('change', handleRemittanceCsvUpload);
// END: CSV 파일 입력 이벤트 리스너 추가

}

// ================== 2. Firebase 데이터 처리 (CRUD) ==================

// --- 2.1 입출고 (Transaction) ---
async function processTransaction(isEdit) {
    const record = {
        type: document.getElementById('transaction-type').value,
        date: document.getElementById('transaction-date').value,
        brand: document.getElementById('tran-brand').value.trim(),
        lot: document.getElementById('tran-lot').value.trim(),
        company: document.getElementById('transaction-company').value.trim(),
        weight: Number(document.getElementById('transaction-weight').value) || 0,
        unitPrice: Number(document.getElementById('transaction-unit-price').value) || 0,
        otherCosts: Number(document.getElementById('transaction-other-costs').value) || 0,
        product: document.getElementById('tran-product').value.trim(),
        spec: document.getElementById('tran-spec').value.trim(),
        notes: document.getElementById('transaction-notes').value.trim(),
        destination: document.getElementById('transaction-destination').value.trim(),
        specialNotes: document.getElementById('transaction-special-notes').value.trim()
    };

    if (!record.date || !record.brand || !record.lot || record.weight <= 0 || !record.company) {
        return alert('필수 항목(날짜, 브랜드, LOT, 중량, 업체)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingTransactionId) {
            await transactionsCollection.doc(editingTransactionId).update(record);
            alert('거래내역이 성공적으로 수정되었습니다.');
        } else {
            await transactionsCollection.add(record);
            alert('입출고 내역이 성공적으로 등록되었습니다.');
        }
        cancelTransactionEdit();
    } catch (error) {
        console.error("데이터 저장/수정 오류:", error);
        alert(`데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

async function processBulkTransactions(records) {
    const batch = db.batch();
    records.forEach(record => {
        if (!record.date || !record.brand || !record.lot || record.weight <= 0 || !record.company) return;
        const docRef = transactionsCollection.doc();
        batch.set(docRef, record);
    });
    try {
        await batch.commit();
        alert(`${records.length}건의 데이터가 성공적으로 등록되었습니다.`);
    } catch (error) {
        console.error("대량 등록 오류:", error);
        alert(`대량 등록 중 오류 발생: ${error.message}`);
    }
}

async function deleteSelectedTransactions() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 거래를 삭제하시겠습니까?`)) return;
    try {
        if (editingTransactionId && selectedIds.includes(editingTransactionId)) {
            cancelTransactionEdit();
        }
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(transactionsCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 거래가 삭제되었습니다.`);
    } catch (error) {
        console.error("데이터 삭제 오류:", error);
        alert("데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}

// --- 2.2 수입원가 (Import Cost) ---
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
    const tariffCost = ic_pFloat(sheetData.tariffAmount);
    const totalForwarderFee = ic_pFloat(sheetData.forwarderFee1) + ic_pFloat(sheetData.forwarderFee2) + ic_pFloat(sheetData.forwarderFee3);
    const grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;
    sheetData.items.forEach(item => {
        item.unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
    });
    try {
        if (isEdit && ic_editingId) {
            await importCostSheetsCollection.doc(ic_editingId).update(sheetData);
            alert('수정되었습니다.');
        } else {
            await importCostSheetsCollection.add(sheetData);
            alert('등록되었습니다.');
        }
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

// --- 2.3 신규: 매출 (Sales) ---
async function processSale(isEdit) {
    const record = {
        date: document.getElementById('sales-date').value,
        company: document.getElementById('sales-company').value.trim(),
        brand: document.getElementById('sales-brand').value.trim(),
        itemCategory: document.getElementById('sales-item-category').value,
        product: document.getElementById('sales-product').value.trim(),
        spec: document.getElementById('sales-spec').value.trim(),
        quantity: Number(document.getElementById('sales-quantity').value) || 0,
        unit: document.getElementById('sales-unit').value,
        sellingPrice: Number(document.getElementById('sales-selling-price').value) || 0,
        costPrice: Number(document.getElementById('sales-cost-price').value) || 0,
        totalSales: Number(document.getElementById('sales-total-sales').value) || 0,
        totalMargin: Number(document.getElementById('sales-total-margin').value) || 0,
        notes: document.getElementById('sales-notes').value.trim()
    };

    if (!record.date || !record.company || !record.brand || record.quantity <= 0 || record.sellingPrice < 0) {
        return alert('필수 항목(날짜, 업체, 브랜드, 수량, 판가)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingSaleId) {
            await salesCollection.doc(editingSaleId).update(record);
            alert('매출 내역이 성공적으로 수정되었습니다.');
        } else {
            await salesCollection.add(record);
            alert('매출 내역이 성공적으로 등록되었습니다.');
        }
        cancelSaleEdit();
    } catch (error) {
        console.error("매출 데이터 저장/수정 오류:", error);
        alert(`매출 데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

async function deleteSelectedSales() {
    const selectedIds = Array.from(document.querySelectorAll('.sales-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 매출을 삭제하시겠습니까?`)) return;
    try {
        if (editingSaleId && selectedIds.includes(editingSaleId)) {
            cancelSaleEdit();
        }
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(salesCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 매출이 삭제되었습니다.`);
    } catch (error) {
        console.error("매출 데이터 삭제 오류:", error);
        alert("매출 데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}

// --- 2.4 신규: 해외송금 (Remittance) ---
async function processRemittance(isEdit) {
    const record = {
        date: document.getElementById('remit-date').value,
        company: document.getElementById('remit-company').value.trim(),
        brand: document.getElementById('remit-brand').value.trim(),
        itemCategory: document.getElementById('remit-item-category').value,
        product: document.getElementById('remit-product').value.trim(),
        spec: document.getElementById('remit-spec').value.trim(),
        quantity: Number(document.getElementById('remit-quantity').value) || 0,
        unit: document.getElementById('remit-unit').value,
        unitPrice: Number(document.getElementById('remit-unit-price').value) || 0,
        totalAmount: Number(document.getElementById('remit-total-amount').value) || 0,
        notes: document.getElementById('remit-notes').value.trim()
    };

    if (!record.date || !record.company || !record.brand || record.quantity <= 0 || record.unitPrice < 0) {
        return alert('필수 항목(날짜, 업체, 브랜드, 수량, 단가)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingRemittanceId) {
            await remittancesCollection.doc(editingRemittanceId).update(record);
            alert('해외 송금 내역이 성공적으로 수정되었습니다.');
        } else {
            await remittancesCollection.add(record);
            alert('해외 송금 내역이 성공적으로 등록되었습니다.');
        }
        cancelRemittanceEdit();
    } catch (error) {
        console.error("해외송금 데이터 저장/수정 오류:", error);
        alert(`해외송금 데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

async function deleteSelectedRemittances() {
    const selectedIds = Array.from(document.querySelectorAll('.remittance-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 송금 내역을 삭제하시겠습니까?`)) return;
    try {
        if (editingRemittanceId && selectedIds.includes(editingRemittanceId)) {
            cancelRemittanceEdit();
        }
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(remittancesCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 송금 내역이 삭제되었습니다.`);
    } catch (error) {
        console.error("해외송금 데이터 삭제 오류:", error);
        alert("해외송금 데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}


// ================== 3. 백업/복원 기능 추가 ==================

function backupDataToJson() {
    const backupData = { 
        transactions: transactions, 
        importCostSheets: ic_costSheets,
        sales: sales,
        remittances: remittances
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

async function restoreDataFromJson() {
    if (!currentBackupFile) return alert('먼저 복원할 백업 파일을 선택해주세요.');
    if (prompt("경고: 이 작업은 클라우드의 모든 데이터를 덮어씁니다. 계속하려면 '복원합니다' 라고 정확히 입력해주세요.") !== '복원합니다') {
        return alert('복원 작업이 취소되었습니다.');
    }
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            if (!parsedData.transactions || !parsedData.importCostSheets || !parsedData.sales || !parsedData.remittances) {
                return alert('선택된 파일이 유효한 백업 파일이 아닙니다.');
            }
            alert('복원을 시작합니다. 완료 메시지가 나타날 때까지 기다려주세요.');
            
            const [oldTrans, oldSheets, oldSales, oldRemits] = await Promise.all([
                transactionsCollection.get(), 
                importCostSheetsCollection.get(),
                salesCollection.get(),
                remittancesCollection.get()
            ]);
            const deleteBatch = db.batch();
            oldTrans.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldSheets.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldSales.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldRemits.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            const addBatch = db.batch();
            parsedData.transactions.forEach(doc => { const { id, ...data } = doc; addBatch.set(transactionsCollection.doc(), data); });
            parsedData.importCostSheets.forEach(doc => { const { id, ...data } = doc; addBatch.set(importCostSheetsCollection.doc(), data); });
            parsedData.sales.forEach(doc => { const { id, ...data } = doc; addBatch.set(salesCollection.doc(), data); });
            parsedData.remittances.forEach(doc => { const { id, ...data } = doc; addBatch.set(remittancesCollection.doc(), data); });
            await addBatch.commit();
            
            document.getElementById('backup-status').innerText = '데이터가 성공적으로 복원되었습니다.';
            alert('데이터 복원이 완료되었습니다!');
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

function updateDatalists() {
    const sets = { brand: new Set(), lot: new Set(), company: new Set() };
    transactions.forEach(t => {
        if (t.brand) sets.brand.add(t.brand);
        if (t.lot) sets.lot.add(t.lot);
        if (t.company) sets.company.add(t.company);
    });
    sales.forEach(s => {
        if (s.brand) sets.brand.add(s.brand);
        if (s.company) sets.company.add(s.company);
    });
    remittances.forEach(r => {
        if (r.brand) sets.brand.add(r.brand);
        if (r.company) sets.company.add(r.company);
    });

    const toOption = item => `<option value="${item}"></option>`;
    document.getElementById('brand-list').innerHTML = [...sets.brand].sort().map(toOption).join('');
    document.getElementById('lot-list').innerHTML = [...sets.lot].sort().map(toOption).join('');
    document.getElementById('company-list-tran').innerHTML = [...sets.company].sort().map(toOption).join('');
    document.getElementById('company-list-invoice').innerHTML = [...sets.company].sort().map(toOption).join('');
}

// --- updateAll 함수 수정 ---
function updateAll() {
    recalculateInventory(); 
    applyFiltersAndRender(); 
    updateDatalists();
    generateSalesReport(); 
    displayInventorySummary();
    // updateDashboard(); // [수정] 이 함수는 데이터 로드 시 직접 호출되므로 여기서 중복 호출 제거
}

// --- showTab 함수 수정 ---
function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    // 탭 버튼 활성화
    const tabButton = document.querySelector(`.tab[onclick="showTab('${tabName}')"]`);
    if (tabButton) tabButton.classList.add('active');
    // 해당 탭 내용 활성화
    const tabContent = document.getElementById(tabName);
    if (tabContent) tabContent.classList.add('active');

    // 다른 탭으로 이동 시 편집 상태 초기화
    cancelTransactionEdit();
    cancelSaleEdit();
    cancelRemittanceEdit();
    ic_clearForm();

    // 탭별 특수 처리
    if (tabName === 'sales-report') generateSalesReport();
    if (tabName === 'dashboard') updateDashboard(); // [추가]


    // 거래명세표/청구서 탭이 아닐 경우 관련 영역 숨기기
    if (tabName !== 'invoice') {
         const invoiceWrapper = document.getElementById('invoice-wrapper');
         const billWrapper = document.getElementById('bill-wrapper');
         if(invoiceWrapper) invoiceWrapper.style.display = 'none';
         if(billWrapper) billWrapper.style.display = 'none';
    }
    // 'invoice' 탭일 경우, generateInvoice/generateBill 함수가 display를 'block'으로 설정합니다.
}

// ... (ic_pFloat, toggleOtherCostsField, applyFiltersAndRender 등 기존 함수들 유지)

// [추가] 대시보드 관련 함수들
/**
 * 숫자 통화 형식으로 포맷 (예: 1,234,567 원)
 * @param {number} num - 포맷할 숫자
 */
function formatCurrency(num) {
    return `${Math.round(num).toLocaleString('ko-KR')} 원`;
}

/**
 * 대시보드 전체 데이터를 계산하고 UI를 업데이트합니다.
 */
function updateDashboard() {
    const yearFilterEl = document.getElementById('dashboard-year-filter');
    if (!yearFilterEl) return; // 대시보드 탭이 로드되기 전이면 중단
    
    const selectedYear = yearFilterEl.value;
    if (!selectedYear) return;

    let totalSales = 0;
    let totalCost = 0;
    let monthlySales = Array(12).fill(0);
    let monthlyMargin = Array(12).fill(0);
    let brandMargin = {};
    let companyMargin = {};

    // 1. '출고' 거래 데이터 처리
    transactions.forEach(t => {
        if (t.type === '출고' && t.date.startsWith(selectedYear)) {
            const month = new Date(t.date).getMonth(); // 0-11
            
            // 매출액
            const salesAmount = (t.weight || 0) * (t.unitPrice || 0);
            totalSales += salesAmount;
            monthlySales[month] += salesAmount;
            
            // 원가
            const matchingInbound = transactions.filter(it => it.type === '입고' && it.brand === t.brand && it.lot === t.lot).sort((a,b) => new Date(b.date) - new Date(a.date));
            const costPrice = matchingInbound.length > 0 ? (matchingInbound[0].unitPrice || 0) : 0;
            const costOfGoods = (t.weight || 0) * costPrice;
            totalCost += costOfGoods;

            // 마진
            const margin = salesAmount - costOfGoods;
            monthlyMargin[month] += margin;
            
            // Top 5 집계
            if (t.brand) brandMargin[t.brand] = (brandMargin[t.brand] || 0) + margin;
            if (t.company) companyMargin[t.company] = (companyMargin[t.company] || 0) + margin;
        }
    });

    // 2. '일반 매출' 데이터 처리
    sales.forEach(s => {
        if (s.date.startsWith(selectedYear)) {
            const month = new Date(s.date).getMonth(); // 0-11

            // 매출액
            const salesAmount = s.totalSales || 0;
            totalSales += salesAmount;
            monthlySales[month] += salesAmount;

            // 원가
            const costOfGoods = s.totalMargin ? (salesAmount - (s.totalMargin || 0)) : (s.quantity * s.costPrice) || 0;
            totalCost += costOfGoods;

            // 마진
            const margin = s.totalMargin || (salesAmount - costOfGoods);
            monthlyMargin[month] += margin;

            // Top 5 집계
            if (s.brand) brandMargin[s.brand] = (brandMargin[s.brand] || 0) + margin;
            if (s.company) companyMargin[s.company] = (companyMargin[s.company] || 0) + margin;
        }
    });

    // 3. KPI 카드 업데이트
    const totalMargin = totalSales - totalCost;
    const marginRate = totalSales !== 0 ? (totalMargin / totalSales * 100).toFixed(1) : 0;

    document.getElementById('kpi-total-sales').innerText = formatCurrency(totalSales);
    document.getElementById('kpi-total-margin').innerText = formatCurrency(totalMargin);
    document.getElementById('kpi-margin-rate').innerText = `${marginRate} %`;

    // 4. 월별 실적 차트 렌더링
    renderDashboardChart(monthlySales, monthlyMargin, selectedYear);

    // 5. Top 5 테이블 렌더링
    const renderTop5Table = (dataMap, tbodyId) => {
        const sortedData = Object.entries(dataMap)
            .sort(([, marginA], [, marginB]) => marginB - marginA)
            .slice(0, 5);
        
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = '';
        sortedData.forEach(([name, margin], index) => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${name}</td>
                <td style="text-align: right;">${formatCurrency(margin)}</td>
            `;
        });
    };

    renderTop5Table(brandMargin, 'top-brands-tbody');
    renderTop5Table(companyMargin, 'top-companies-tbody');
}

/**
 * 월별 실적 차트를 렌더링합니다.
 * @param {number[]} salesData - 12개월치 매출 데이터
 * @param {number[]} marginData - 12개월치 마진 데이터
 * @param {string} year - 기준 년도
 */
function renderDashboardChart(salesData, marginData, year) {
    const ctx = document.getElementById('monthly-chart')?.getContext('2d');
    if (!ctx) return;

    if (dashboardChart) {
        dashboardChart.destroy(); // 기존 차트 파괴
    }

    const labels = Array.from({length: 12}, (_, i) => `${year}-${(i + 1).toString().padStart(2, '0')}`);

    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '총 매출',
                    data: salesData,
                    backgroundColor: 'rgba(102, 126, 234, 0.7)', // --primary-color
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 1
                },
                {
                    label: '최종 마진',
                    data: marginData,
                    backgroundColor: 'rgba(40, 167, 69, 0.7)', // --success-color
                    borderColor: 'rgba(40, 167, 69, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return (value / 1000000).toLocaleString('ko-KR') + '백만';
                        }
                    }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            label += formatCurrency(context.parsed.y);
                            return label;
                        }
                    }
                }
            }
        }
    });
}


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
        product: document.getElementById('filter-inv-product').value.toLowerCase(),
        spec: document.getElementById('filter-inv-spec').value.toLowerCase(),
        lot: document.getElementById('filter-inv-lot').value.toLowerCase()
    };
    const filteredInventory = inventory.filter(i => 
        i.brand.toLowerCase().includes(invFilters.brand) &&
        (i.product || '').toLowerCase().includes(invFilters.product) &&
        (i.spec || '').toLowerCase().includes(invFilters.spec) &&
        i.lot.toLowerCase().includes(invFilters.lot)
    );
    updateInventoryTable(filteredInventory);
    displayInventorySummary(); // 파라미터 없이 호출 (이미 올바름)

    const tranFilters = {
        type: document.getElementById('filter-tran-type').value,
        month: document.getElementById('filter-tran-month').value,
        brand: document.getElementById('filter-tran-brand').value.toLowerCase(),
        product: document.getElementById('filter-tran-product').value.toLowerCase(),
        spec: document.getElementById('filter-tran-spec').value.toLowerCase(),
        lot: document.getElementById('filter-tran-lot').value.toLowerCase(),
        company: document.getElementById('filter-tran-company').value.toLowerCase()
    };
    const filteredTransactions = transactions.filter(t => 
        (!tranFilters.type || t.type === tranFilters.type) &&
        (!tranFilters.month || t.date.startsWith(tranFilters.month)) &&
        (t.brand?.toLowerCase().includes(tranFilters.brand)) &&
        (t.product?.toLowerCase().includes(tranFilters.product)) &&
        (t.spec?.toLowerCase().includes(tranFilters.spec)) &&
        (t.lot?.toLowerCase().includes(tranFilters.lot)) && 
        (t.company.toLowerCase().includes(tranFilters.company))
    );
    updateTransactionTable(filteredTransactions);
}

function resetInventoryFilters() {
    ['filter-inv-brand', 'filter-inv-product', 'filter-inv-spec', 'filter-inv-lot'].forEach(id => document.getElementById(id).value = '');
    applyFiltersAndRender();
}

function resetTransactionFilters() {
    ['filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-product', 'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company'].forEach(id => document.getElementById(id).value = '');
    applyFiltersAndRender();
}

function resetSalesReportFilters() {
  ['filter-report-start-date', 'filter-report-end-date', 'filter-report-company', 'filter-report-brand', 'filter-report-item-category', 'filter-report-product', 'filter-report-spec']
  .forEach(id => document.getElementById(id).value = '');
    generateSalesReport();
}

function recalculateInventory() {
    const tempInventoryMap = new Map();
    const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTransactions.forEach(t => {
        const itemKey = `${t.brand}_${t.product}_${t.spec}_${t.lot}`;
        if (!tempInventoryMap.has(itemKey)) {
            tempInventoryMap.set(itemKey, {
                id: itemKey, brand: t.brand, lot: t.lot, quantity: 0, product: t.product,
                spec: t.spec, costPrice: 0, receivedDate: null
            });
        }
        const currentItem = tempInventoryMap.get(itemKey);
        const weight = parseFloat(t.weight) || 0;
        
        if (t.type === '입고') {
            currentItem.quantity += weight;
            if (t.unitPrice > 0) currentItem.costPrice = t.unitPrice;
            if (t.product) currentItem.product = t.product;
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
            <td>${item.brand}</td> <td>${item.product || 'N/A'}</td> <td>${item.spec || ''}</td>
            <td>${item.lot}</td> <td>${item.quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${item.receivedDate || '-'}</td>
            <td><button class="action-btn" onclick="showItemHistoryInTransactionTab('${item.brand}', '${item.product || ''}', '${item.spec || ''}', '${item.lot}')">내역 보기</button></td>`;
    });
    document.getElementById('total-inv-weight').innerText = totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// START: 품목별 재고 요약 함수 추가
function displayInventorySummary() {
    const summary = {};
    // 전체 인벤토리 데이터(필터링 안된 것)를 기준으로 요약 계산
    inventory.forEach(item => {
        if (item.quantity < 0.0001) return; // 0 또는 아주 작은 재고는 제외
        // 키 생성: 브랜드 / 제품 / 스펙
        const key = `${item.brand || 'N/A'} / ${item.product || 'N/A'} / ${item.spec || 'N/A'}`;
        summary[key] = (summary[key] || 0) + item.quantity;
    });

    const tbody = document.getElementById('inventory-summary-tbody');
    tbody.innerHTML = '';
    let totalSummaryWeight = 0;

    // 키(브랜드/제품/스펙) 기준으로 정렬하여 표시
    Object.keys(summary).sort().forEach(key => {
        const quantity = summary[key];
        totalSummaryWeight += quantity;
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${key}</td>
            <td style="text-align: right; padding-right: 10px;">${quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</td>
        `;
    });

    // 총 합계 업데이트
    document.getElementById('total-summary-inv-weight').innerText = totalSummaryWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
}
// END: 품목별 재고 요약 함수 추가


function showItemHistoryInTransactionTab(brand, product, spec, lot) {
    showTab('transaction');
    document.getElementById('filter-tran-brand').value = brand;
    document.getElementById('filter-tran-product').value = product;
    document.getElementById('filter-tran-spec').value = spec;
    document.getElementById('filter-tran-lot').value = lot;
    applyFiltersAndRender();
}

function updateTransactionTable(transactionsToDisplay) {
    const tbody = document.getElementById('transaction-tbody');
    tbody.innerHTML = '';
    let totalWeight = 0, totalAmount = 0;

    transactionsToDisplay.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const weight = parseFloat(t.weight) || 0;
        const unitPrice = parseFloat(t.unitPrice) || 0;
        const amount = weight * unitPrice;
        
        if(t.type === '입고') totalWeight += weight; else totalWeight -= weight;
        totalAmount += amount;
       
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="transaction-checkbox" value="${t.id}"></td>
            <td>${t.type}</td><td>${t.date}</td><td>${t.brand || ''}</td>
            <td>${t.product || ''}</td><td>${t.spec || ''}</td><td>${t.lot || ''}</td>
            <td>${weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${unitPrice.toLocaleString('en-US')}</td>
            <td>${amount.toLocaleString('en-US')}</td>
            <td>${t.company}</td><td>${t.notes || ''}</td><td>${t.destination || ''}</td><td>${t.specialNotes || ''}</td>`;
    });

    document.getElementById('total-tran-weight').innerText = totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('total-tran-amount').innerText = totalAmount.toLocaleString('en-US');
    document.getElementById('select-all-transactions').checked = false;
}

function editSelectedTransaction() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const transaction = transactions.find(t => t.id === selectedIds[0]);
    if (!transaction) return alert("오류: 데이터를 찾을 수 없습니다. 페이지를 새로고침하고 다시 시도해주세요.");
    
    editingTransactionId = transaction.id;
    document.getElementById('transaction-type').value = transaction.type;
    document.getElementById('transaction-date').value = transaction.date;
    document.getElementById('tran-brand').value = transaction.brand;
    document.getElementById('tran-lot').value = transaction.lot;
    document.getElementById('tran-product').value = transaction.product || '';
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
        document.getElementById('tran-product').value = recent.product || '';
        document.getElementById('tran-spec').value = recent.spec || '';
        if (recent.unitPrice > 0) document.getElementById('transaction-unit-price').value = recent.unitPrice;
    }
}

function openBulkUploadModal() { document.getElementById('bulkUploadModal').style.display = 'flex'; }
function closeBulkUploadModal() { document.getElementById('bulkUploadModal').style.display = 'none'; }
function downloadBulkTransactionTemplate() {
    const headers = ['거래구분(입고/출고)', '날짜(YYYY-MM-DD)*', '브랜드*', 'LOT 번호*', '중량(kg)*', '단가(원/kg)', '기타 비용', '제품', '스펙 (예: 75/48)', '업체*', '비고', '도착지', '특이사항'];
    downloadCSV(headers.join(','), '대량입출고_템플릿');
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
                product: row['제품']?.trim() || '',
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
    link.click();
}

function exportInventoryCSV() {
    const csvData = inventory.map(item => ({
        '브랜드': item.brand, '제품': item.product || '','스펙': item.spec || '','LOT': item.lot,
        '현재 수량(kg)': item.quantity.toFixed(2)
    }));
    downloadCSV(Papa.unparse(csvData), '재고현황');
}

function exportTransactionCSV() {
    const csvData = transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).map(t => ({
        '거래구분': t.type, '날짜': t.date, '브랜드': t.brand, '제품': t.product, '스펙': t.spec, 'LOT': t.lot,
        '중량(kg)': t.weight, '단가(원/kg)': t.unitPrice, '금액(원)': t.weight * t.unitPrice, 
        '업체': t.company, '비고': t.notes, '도착지': t.destination, '특이사항': t.specialNotes
    }));
    downloadCSV(Papa.unparse(csvData), '입출고현황');
}

function exportSalesReportCSV() {
    const tbody = document.getElementById('sales-report-tbody');
    const headers = ['월', '업체', '브랜드', '품목', '제품', '스펙', 'LOT', '수량', '총 매입(원)', '매출 금액(원)', '최종 마진(원)', '마진율(%)'];
    const data = Array.from(tbody.rows).map(row => {
        const cells = Array.from(row.cells);
        let rowData = {};
        headers.forEach((header, i) => { rowData[header] = cells[i].innerText; });
        return rowData;
    });
    downloadCSV(Papa.unparse(data, { header: true }), '매출보고서');
}

// START: CSV 처리 공통 함수 추가
// 파일 선택 시 호출되는 공통 핸들러
function handleCsvUpload(event, previewDivId, contentDivId, setDataCallback) {
    const file = event.target.files[0];
    const previewDiv = document.getElementById(previewDivId);
    if (file && previewDiv) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            preview: 5, // 미리보기는 첫 5줄만
            complete: (results) => {
                if (results.data && results.data.length > 0) {
                    setDataCallback(results.data); // 미리보기용 데이터 저장 (전체 아님)
                    displayCsvPreview(results.data, results.meta.fields, contentDivId);
                    previewDiv.style.display = 'block';
                } else {
                    setDataCallback(null);
                    previewDiv.style.display = 'none';
                    alert('CSV 파일에 유효한 데이터가 없거나 헤더만 있습니다.');
                }
            },
            error: (error) => {
                console.error('CSV 파싱 오류:', error);
                alert(`CSV 파일을 읽는 중 오류가 발생했습니다: ${error.message}`);
                previewDiv.style.display = 'none';
                setDataCallback(null);
            }
        });
    } else if (previewDiv) {
        previewDiv.style.display = 'none';
        setDataCallback(null);
    }
}

// 미리보기 테이블 생성 함수
function displayCsvPreview(data, headers, contentElementId) {
    const previewContent = document.getElementById(contentElementId);
    if (!previewContent) return;
    let tableHTML = '<table style="width:100%; font-size: 12px; border-collapse: collapse;"><thead><tr>';
    tableHTML += headers.map(h => `<th style="border: 1px solid #ddd; padding: 5px; background-color: #f2f2f2;">${h}</th>`).join('');
    tableHTML += '</tr></thead><tbody>';
    data.forEach(row => {
        tableHTML += `<tr>${headers.map(h => `<td style="border: 1px solid #ddd; padding: 5px;">${row[h] || ''}</td>`).join('')}</tr>`;
    });
    tableHTML += '</tbody></table>';
    if (data.length === 5) { // 미리보기가 5줄 꽉 찼으면 안내 문구 추가
        tableHTML += '<p style="font-size: 11px; color: #888; margin-top: 5px;">(첫 5줄 미리보기)</p>';
    }
    previewContent.innerHTML = tableHTML;
}

// CSV 업로드 처리 공통 로직
async function processCsvData(previewData, fileInputId, processRowCallback, cancelCallback, dataTypeLabel) {
    const fileInput = document.getElementById(fileInputId);
    const file = fileInput.files[0];

    if (!file) {
        return alert(`${dataTypeLabel} CSV 파일을 먼저 선택해주세요.`);
    }
    if (!previewData) { // previewData는 handleCsvUpload에서 설정됨
         return alert(`미리보기 데이터가 없습니다. 파일을 다시 선택해주세요.`);
    }

    alert(`${dataTypeLabel} 데이터 업로드를 시작합니다. 완료 메시지가 나올 때까지 기다려주세요.`);

    Papa.parse(file, { // 실제 처리는 전체 파일로 다시 파싱
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            const rows = results.data;
            if (!rows || rows.length === 0) {
                cancelCallback();
                return alert('CSV 파일에 처리할 데이터가 없습니다.');
            }

            let successCount = 0;
            let failCount = 0;
            const promises = [];

            rows.forEach((row, index) => {
                            try {
                                const promise = processRowCallback(row, index);
                                if (promise) { // 유효성 검사 통과 및 Firestore 작업 Promise 반환 시
                                    promises.push(promise.then(() => successCount++).catch(err => {
                                        console.error(`행 ${index + 2} 처리 오류:`, err);
                                        failCount++;
                                    }));
                                } else { // 유효성 검사 실패 시 (processRowCallback이 null 반환)
                                    failCount++;
                                }
                            } catch (e) { // processRowCallback 자체에서 동기적 에러 발생 시
                                console.error(`행 ${index + 2} 파싱/유효성 검사 중 동기 오류:`, e);
                                failCount++;
                            }
                        });

            try {
                await Promise.all(promises); // 모든 Firestore 작업 기다리기
                alert(`${dataTypeLabel} CSV 처리 완료: 성공 ${successCount}건, 실패 ${failCount}건.`);
            } catch (batchError) {
                // Firestore 배치 작업 중 하나라도 실패하면 여기로 올 수 있음 (개별 처리 시는 위에서 잡힘)
                console.error(`${dataTypeLabel} 일괄 처리 중 오류:`, batchError);
                alert(`${dataTypeLabel} 처리 중 일부 오류 발생. 성공 ${successCount}건, 실패 ${failCount}건 이상.`);
            } finally {
                cancelCallback(); // 미리보기 닫기 및 관련 상태 초기화
                // 데이터가 변경되었으므로 관련 테이블 업데이트 (예: displaySales(), displayRemittances())
                // 이 부분은 각 탭의 process 함수 내에서 호출되거나 여기서 직접 호출할 수 있음
                // 예시: if (dataTypeLabel === '매출') applySalesFiltersAndRender();
                //       if (dataTypeLabel === '해외송금') applyRemittanceFiltersAndRender();
                // updateAll()을 호출하면 모든 데이터가 리프레시되지만, Firestore 리스너가 있다면 자동으로 반영될 수 있음
            }
        },
        error: (error) => {
            console.error('CSV 전체 파싱 오류:', error);
            alert(`CSV 파일 처리 중 오류가 발생했습니다: ${error.message}`);
            cancelCallback();
        }
    });
}

// CSV 미리보기 및 파일 선택 취소 공통 함수
function cancelCsvUpload(fileInputId, previewDivId, resetDataCallback) {
    const fileInput = document.getElementById(fileInputId);
    const previewDiv = document.getElementById(previewDivId);
    if (fileInput) fileInput.value = ''; // 파일 선택 초기화
    if (previewDiv) previewDiv.style.display = 'none'; // 미리보기 숨기기
    resetDataCallback(); // 해당 CSV 데이터 변수 초기화 (예: salesCsvData = null)
}
// END: CSV 처리 공통 함수 추가



// ================== 4-1. 신규 매출 탭 관련 함수 ==================

function calculateSales() {
    const quantity = Number(document.getElementById('sales-quantity').value) || 0;
    const sellingPrice = Number(document.getElementById('sales-selling-price').value) || 0;
    const costPrice = Number(document.getElementById('sales-cost-price').value) || 0;
    const totalSales = quantity * sellingPrice;
    const totalCost = quantity * costPrice;
    const totalMargin = totalSales - totalCost;
    document.getElementById('sales-total-sales').value = totalSales;
    document.getElementById('sales-total-margin').value = totalMargin;
}

function applySalesFiltersAndRender() {
    const filters = {
        startMonth: document.getElementById('filter-sales-start-month').value,
        endMonth: document.getElementById('filter-sales-end-month').value,
        company: document.getElementById('filter-sales-list-company').value.toLowerCase(),
        brand: document.getElementById('filter-sales-list-brand').value.toLowerCase(),
        itemCategory: document.getElementById('filter-sales-list-item-category').value.toLowerCase(),
        product: document.getElementById('filter-sales-list-product').value.toLowerCase(),
        spec: document.getElementById('filter-sales-list-spec').value.toLowerCase(),
    };
    const filteredSales = sales.filter(s => {
        const month = s.date.substring(0, 7);
        const startCheck = !filters.startMonth || month >= filters.startMonth;
        const endCheck = !filters.endMonth || month <= filters.endMonth;
        return startCheck && endCheck &&
               (s.company || '').toLowerCase().includes(filters.company) &&
               (s.brand || '').toLowerCase().includes(filters.brand) &&
               (s.itemCategory || '').toLowerCase().includes(filters.itemCategory) &&
               (s.product || '').toLowerCase().includes(filters.product) &&
               (s.spec || '').toLowerCase().includes(filters.spec);
    });
    updateSalesTable(filteredSales);
}

function updateSalesTable(salesToDisplay) {
    const tbody = document.getElementById('sales-tbody');
    tbody.innerHTML = '';
    salesToDisplay.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(s => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="sales-checkbox" value="${s.id}"></td>
            <td>${s.date}</td><td>${s.company}</td><td>${s.brand}</td>
            <td>${s.itemCategory}</td><td>${s.product || ''}</td><td>${s.spec || ''}</td>
            <td>${s.quantity.toLocaleString()}</td><td>${s.unit}</td>
            <td>${s.sellingPrice.toLocaleString()}</td><td>${s.costPrice.toLocaleString()}</td>
            <td>${s.totalSales.toLocaleString()}</td><td>${s.totalMargin.toLocaleString()}</td>
            <td>${s.notes || ''}</td>`;
    });
    document.getElementById('select-all-sales').checked = false;
}

function editSelectedSale() {
    const selectedIds = Array.from(document.querySelectorAll('.sales-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const sale = sales.find(s => s.id === selectedIds[0]);
    if (!sale) return alert("오류: 데이터를 찾을 수 없습니다.");
    
    editingSaleId = sale.id;
    document.getElementById('sales-date').value = sale.date;
    document.getElementById('sales-company').value = sale.company;
    document.getElementById('sales-brand').value = sale.brand;
    document.getElementById('sales-item-category').value = sale.itemCategory;
    document.getElementById('sales-product').value = sale.product || '';
    document.getElementById('sales-spec').value = sale.spec || '';
    document.getElementById('sales-quantity').value = sale.quantity;
    document.getElementById('sales-unit').value = sale.unit;
    document.getElementById('sales-selling-price').value = sale.sellingPrice;
    document.getElementById('sales-cost-price').value = sale.costPrice;
    document.getElementById('sales-total-sales').value = sale.totalSales;
    document.getElementById('sales-total-margin').value = sale.totalMargin;
    document.getElementById('sales-notes').value = sale.notes || '';
    
    document.getElementById('sales-form-title').innerText = '매출 수정';
    document.getElementById('sales-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processSale(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelSaleEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

function cancelSaleEdit() {
    editingSaleId = null;
    document.getElementById('sales-form').reset();
    calculateSales();
    document.getElementById('sales-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sales-form-title').innerText = '매출 등록';
    document.getElementById('sales-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addSale()">➕ 매출 등록</button>
        <button class="btn btn-success" onclick="downloadSalesCsvTemplate()">📥 CSV 템플릿 다운로드</button>
        <button class="btn btn-warning" onclick="document.getElementById('sales-csv-file').click()">📤 CSV 대량 등록</button>`;
}

function resetSalesFilters() {
    ['filter-sales-start-month', 'filter-sales-end-month', 'filter-sales-list-company', 'filter-sales-list-brand', 'filter-sales-list-item-category', 'filter-sales-list-product', 'filter-sales-list-spec']
    .forEach(id => document.getElementById(id).value = '');
    applySalesFiltersAndRender();
}

function exportSalesCSV() {
    const csvData = sales.sort((a,b) => new Date(b.date) - new Date(a.date)).map(s => ({
        '날짜': s.date, '업체': s.company, '브랜드': s.brand, '품목': s.itemCategory, '제품': s.product,
        '스펙': s.spec, '수량': s.quantity, '단위': s.unit, '판가(원)': s.sellingPrice, '원가(원)': s.costPrice,
        '총매출(원)': s.totalSales, '총마진(원)': s.totalMargin, '비고': s.notes
    }));
    downloadCSV(Papa.unparse(csvData), '매출내역');
}

// START: 매출 CSV 관련 함수 추가
function downloadSalesCsvTemplate() {
    const headers = ["날짜*", "업체*", "브랜드*", "품목*", "제품", "스펙", "수량*", "단위*", "판가(원)*", "원가(원)", "비고"];
    const csv = headers.join(',') + '\n';
    downloadCSV(csv, '매출_등록_템플릿');
}

function handleSalesCsvUpload(event) {
    handleCsvUpload(event, 'sales-csv-preview', 'sales-csv-content', (data) => { salesCsvData = data; });
}

function processSalesCsvUpload() {
    processCsvData(salesCsvData, 'sales-csv-file', (row, index) => {
        const sale = {
            date: row['날짜*']?.trim() || '',
            company: row['업체*']?.trim() || '',
            brand: row['브랜드*']?.trim() || '',
            itemCategory: row['품목*']?.trim() || '',
            product: row['제품']?.trim() || '',
            spec: row['스펙']?.trim() || '',
            quantity: Number(row['수량*']) || 0,
            unit: row['단위*']?.trim() || 'kg',
            sellingPrice: Number(row['판가(원)*']) || 0,
            costPrice: Number(row['원가(원)']) || 0,
            notes: row['비고']?.trim() || ''
        };
        sale.totalSales = sale.quantity * sale.sellingPrice;
        sale.totalMargin = sale.totalSales - (sale.quantity * sale.costPrice);

        if (!sale.date || !sale.company || !sale.brand || !sale.itemCategory || sale.quantity <= 0 || sale.sellingPrice < 0) {
            console.error(`매출 CSV 유효성 검사 실패 (행 ${index + 2}):`, row);
            return null; // 유효하지 않으면 null 반환
        }
        return salesCollection.add(sale); // Firestore에 추가하는 Promise 반환
    }, cancelSalesCsvUpload, '매출');
}

function cancelSalesCsvUpload() {
    cancelCsvUpload('sales-csv-file', 'sales-csv-preview', () => { salesCsvData = null; });
}
// END: 매출 CSV 관련 함수 추가

// ================== 4-2. 신규 해외송금 탭 관련 함수 ==================

function calculateRemittance() {
    const quantity = Number(document.getElementById('remit-quantity').value) || 0;
    const unitPrice = Number(document.getElementById('remit-unit-price').value) || 0;
    const total = quantity * unitPrice;
    document.getElementById('remit-total-amount').value = total.toFixed(2); // 소수점 2자리로 고정
}

function applyRemittanceFiltersAndRender() {
    const filters = {
        startMonth: document.getElementById('filter-remit-start-month').value,
        endMonth: document.getElementById('filter-remit-end-month').value,
        company: document.getElementById('filter-remit-company').value.toLowerCase(),
        brand: document.getElementById('filter-remit-brand').value.toLowerCase(),
        itemCategory: document.getElementById('filter-remit-item-category').value.toLowerCase(),
        product: document.getElementById('filter-remit-product').value.toLowerCase(),
        spec: document.getElementById('filter-remit-spec').value.toLowerCase()
    };
    const filteredRemittances = remittances.filter(r => {
        const month = r.date.substring(0, 7);
        const startCheck = !filters.startMonth || month >= filters.startMonth;
        const endCheck = !filters.endMonth || month <= filters.endMonth;
        return startCheck && endCheck &&
               (r.company || '').toLowerCase().includes(filters.company) &&
               (r.brand || '').toLowerCase().includes(filters.brand) &&
               (r.itemCategory || '').toLowerCase().includes(filters.itemCategory) &&
               (r.product || '').toLowerCase().includes(filters.product) &&
               (r.spec || '').toLowerCase().includes(filters.spec);
    });
    updateRemittanceTable(filteredRemittances);
}

function updateRemittanceTable(remittancesToDisplay) {
    const tbody = document.getElementById('remittance-tbody');
    tbody.innerHTML = '';
    let totalAmountSum = 0; // 총합계 변수 추가
    remittancesToDisplay.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(r => {
        totalAmountSum += r.totalAmount || 0; // 합계 계산
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="remittance-checkbox" value="${r.id}"></td>
            <td>${r.date}</td><td>${r.company}</td><td>${r.brand}</td>
            <td>${r.itemCategory}</td><td>${r.product || ''}</td><td>${r.spec || ''}</td>
            <td>${r.quantity.toLocaleString()}</td><td>${r.unit}</td>
            <td>${(r.unitPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${(r.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${r.notes || ''}</td>`;
    });
    // 총합계 tfoot에 표시 (html에 tfoot이 추가되어 있어야 함)
    const totalEl = document.getElementById('total-remit-amount');
    if (totalEl) {
        totalEl.innerText = totalAmountSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    document.getElementById('select-all-remittances').checked = false;
}


function editSelectedRemittance() {
    const selectedIds = Array.from(document.querySelectorAll('.remittance-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const remittance = remittances.find(r => r.id === selectedIds[0]);
    if (!remittance) return alert("오류: 데이터를 찾을 수 없습니다.");
    
    editingRemittanceId = remittance.id;
    document.getElementById('remit-date').value = remittance.date;
    document.getElementById('remit-company').value = remittance.company;
    document.getElementById('remit-brand').value = remittance.brand;
    document.getElementById('remit-item-category').value = remittance.itemCategory;
    document.getElementById('remit-product').value = remittance.product || '';
    document.getElementById('remit-spec').value = remittance.spec || '';
    document.getElementById('remit-quantity').value = remittance.quantity;
    document.getElementById('remit-unit').value = remittance.unit;
   document.getElementById('remit-unit-price').value = (remittance.unitPrice || 0).toFixed(2);
    document.getElementById('remit-total-amount').value = (remittance.totalAmount || 0).toFixed(2);
    document.getElementById('remit-notes').value = remittance.notes || '';
    
    document.getElementById('remittance-form-title').innerText = '해외 송금 수정';
    document.getElementById('remittance-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processRemittance(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelRemittanceEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

function cancelRemittanceEdit() {
    editingRemittanceId = null;
    document.getElementById('remittance-form').reset();
    calculateRemittance();
    document.getElementById('remit-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('remittance-form-title').innerText = '해외 송금 등록';
    document.getElementById('remittance-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addRemittance()">➕ 송금 등록</button>
        <button class="btn btn-success" onclick="downloadRemittanceCsvTemplate()">📥 CSV 템플릿 다운로드</button>
        <button class="btn btn-warning" onclick="document.getElementById('remit-csv-file').click()">📤 CSV 대량 등록</button>`;
}

function resetRemittanceFilters() {
    ['filter-remit-start-month', 'filter-remit-end-month', 'filter-remit-company', 'filter-remit-brand', 'filter-remit-item-category', 'filter-remit-product', 'filter-remit-spec']
    .forEach(id => document.getElementById(id).value = '');
    applyRemittanceFiltersAndRender();
}

function exportRemittanceCSV() {
    const csvData = remittances.sort((a,b) => new Date(b.date) - new Date(a.date)).map(r => ({
        '날짜': r.date, '업체': r.company, '브랜드': r.brand, '품목': r.itemCategory, '제품': r.product,
        '스펙': r.spec, '수량': r.quantity, '단위': r.unit, '단가($)': r.unitPrice,
        '총합계($)': r.totalAmount, '비고': r.notes
    }));
    downloadCSV(Papa.unparse(csvData), '해외송금내역');
}

// START: 해외송금 CSV 관련 함수 추가
function downloadRemittanceCsvTemplate() {
    const headers = ["날짜*", "업체*", "브랜드*", "품목*", "제품", "스펙", "수량*", "단위*", "단가($)*", "비고"];
    const csv = headers.join(',') + '\n';
    downloadCSV(csv, '해외송금_등록_템플릿');
}

function handleRemittanceCsvUpload(event) {
    handleCsvUpload(event, 'remit-csv-preview', 'remit-csv-content', (data) => { remitCsvData = data; });
}

function processRemittanceCsvUpload() {
    processCsvData(remitCsvData, 'remit-csv-file', (row, index) => {
        const remit = {
            date: row['날짜*']?.trim() || '',
            company: row['업체*']?.trim() || '',
            brand: row['브랜드*']?.trim() || '',
            itemCategory: row['품목*']?.trim() || '',
            product: row['제품']?.trim() || '',
            spec: row['스펙']?.trim() || '',
            quantity: Number(row['수량*']) || 0,
            unit: row['단위*']?.trim() || 'kg',
            unitPrice: Number(row['단가($)*']) || 0, // '단가(원)*' -> '단가($)*'
            notes: row['비고']?.trim() || ''
        };
        remit.totalAmount = parseFloat((remit.quantity * remit.unitPrice).toFixed(2)); // 소수점 2자리까지 계산

        if (!remit.date || !remit.company || !remit.brand || !remit.itemCategory || remit.quantity <= 0 || remit.unitPrice < 0) {

            console.error(`해외송금 CSV 유효성 검사 실패 (행 ${index + 2}):`, row);
            return null; // 유효하지 않으면 null 반환
        }
        return remittancesCollection.add(remit); // Firestore에 추가하는 Promise 반환
    }, cancelRemittanceCsvUpload, '해외송금');
}

function cancelRemittanceCsvUpload() {
    cancelCsvUpload('remit-csv-file', 'remit-csv-preview', () => { remitCsvData = null; });
}
// END: 해외송금 CSV 관련 함수 추가


// ================== 4-3. 거래명세서/청구서 ==================
// START: generateInvoice 함수 교체 (빈 줄 제거)
function generateInvoice() {
    const recipientCompany = document.getElementById('recipient-company').value.trim();
    const startDate = document.getElementById('invoice-start-date').value;
    const endDate = document.getElementById('invoice-end-date').value;
    const transactionType = document.getElementById('invoice-transaction-type').value;

    if (!recipientCompany || !startDate || !endDate) {
        return alert('(*) 필수 항목(회사명, 날짜 범위)을 입력해주세요.');
    }

    // 1. 입출고 데이터 필터링
    const filteredTransactions = transactions.filter(t => {
        return new Date(t.date) >= new Date(startDate) && new Date(t.date) <= new Date(endDate) &&
               (transactionType === 'all' || t.type === transactionType) &&
               t.company.trim().toLowerCase() === recipientCompany.toLowerCase();
    });

    // 2. 매출 데이터 필터링 (출고 또는 전체 선택 시에만)
    const filteredSales = (transactionType === 'all' || transactionType === '출고')
        ? sales.filter(s => {
              return new Date(s.date) >= new Date(startDate) && new Date(s.date) <= new Date(endDate) &&
                     s.company.trim().toLowerCase() === recipientCompany.toLowerCase();
          })
        : [];

    // 3. 데이터 병합 및 정렬
    let combinedItems = [];
    filteredTransactions.forEach(t => combinedItems.push({
        isTransaction: true, // 데이터 출처 구분
        date: t.date, brand: t.brand, product: t.product, spec: t.spec, lot: t.lot,
        unit: 'kg', quantity: t.weight, unitPrice: t.unitPrice, notes: t.notes, destination: t.destination
    }));
    filteredSales.forEach(s => combinedItems.push({
        isTransaction: false, // 데이터 출처 구분
        date: s.date, brand: s.brand, product: s.product, spec: s.spec, lot: '', // 매출엔 LOT 없음
        unit: s.unit, quantity: s.quantity, unitPrice: s.sellingPrice, notes: s.notes, destination: '' // 매출엔 도착지 없음
    }));

    combinedItems.sort((a, b) => new Date(a.date) - new Date(b.date)); // 날짜순 정렬

    if (combinedItems.length === 0) {
        alert('해당 조건에 맞는 거래 또는 매출 내역이 없습니다.');
        return document.getElementById('invoice-wrapper').style.display = 'none';
    }

    const today = new Date().toISOString().split('T')[0];
    let totalAmount = 0; // 총 금액 계산용

    // 4. HTML 생성 (데이터 출처에 따라 약간 다르게 표시 가능)
    const itemsHtml = combinedItems.map(item => {
        const amount = item.quantity * item.unitPrice;
        totalAmount += amount; // 합계 계산
        // 매출 데이터는 단가 편집 불가, 입출고는 가능하도록 설정
        const priceEditable = item.isTransaction ? 'contenteditable="true"' : '';
        const quantityDisplay = item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const unitPriceDisplay = item.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const amountDisplay = Math.round(amount).toLocaleString(); // 금액은 반올림

        return `<tr class="invoice-item-row">
            <td contenteditable="true">${item.date}</td>
            <td contenteditable="true">${item.brand || ''}</td>
            <td contenteditable="true">${item.product || ''}</td>
            <td contenteditable="true">${item.spec || ''}</td>
            <td contenteditable="true">${item.lot || ''}</td>
            <td contenteditable="true">${item.unit}</td>
            <td contenteditable="true" class="invoice-quantity">${quantityDisplay}</td>
            <td ${priceEditable} class="invoice-price">${unitPriceDisplay}</td>
            <td class="invoice-amount">${amountDisplay}</td>
            <td contenteditable="true">${item.notes || ''}</td>
            <td><button class="btn btn-danger btn-sm no-print" onclick="this.closest('tr').remove(); updateInvoiceTotals();">X</button></td>
        </tr>`;
    }).join('');
    
    // 이전에 빈 줄을 추가하던 로직을 삭제함
    const firstDestination = filteredTransactions.find(t => t.destination)?.destination || document.getElementById('recipient-address').value || ''; // 주소 우선순위

    // 5. 최종 HTML 렌더링 (테이블 컬럼 개수 맞추기: 11개)
    document.getElementById('invoice-content').innerHTML = `
        <div class="invoice-header"><h2 class="invoice-title">거래명세표</h2></div>
        <div class="invoice-info">
            <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>자</td><td class="label-td">사업자번호</td><td>101-02-35223</td></tr><tr><td class="label-td">상호</td><td>그루텍스</td></tr><tr><td class="label-td">주소</td><td>서울시 도봉구 노해로 397-15 백상빌딩 1005호</td></tr></table></div>
            <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>받<br>는<br>자</td><td class="label-td">사업자번호</td><td contenteditable="true">${document.getElementById('recipient-reg-no').value}</td></tr><tr><td class="label-td">상호</td><td contenteditable="true">${recipientCompany}</td></tr><tr><td class="label-td">주소</td><td contenteditable="true">${document.getElementById('recipient-address').value}</td></tr></table></div>
        </div>
        <div class="invoice-items">
            <table id="invoice-items-table">
                <thead>
                    <tr><th colspan="11" style="text-align:left; padding-left:10px;">작성일자: ${today}</th></tr>
                    <tr><th>날짜</th><th>브랜드</th><th>제품</th><th>스펙</th><th>LOT</th><th>단위</th><th>수량</th><th>단가</th><th>금액</th><th>비고</th><th class="no-print" style="width: 50px;">삭제</th></tr>
                </thead>
                <tbody id="invoice-tbody">${itemsHtml}</tbody>
                <tfoot>
                    <tr><td colspan="8" style="text-align: right; font-weight: bold;">총 합계 금액</td><td id="invoice-total-amount" style="text-align: right; font-weight: bold;">${Math.round(totalAmount).toLocaleString()}</td><td colspan="2"></td></tr>
                </tfoot>
            </table>
        </div>
        <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">도착지</td><td contenteditable="true" style="text-align:left; padding-left:10px;">${firstDestination}</td></tr></table></div>
        <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">비 고</td><td contenteditable="true" style="height: 80px; text-align:left; vertical-align:top; padding: 5px;"></td></tr></table></div>
        <div class="invoice-company-info" style="margin-top: 30px; padding: 15px; border-top: 2px solid #333; text-align: center;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin-bottom: 10px;"><span style="font-size: 18px; font-weight: bold; letter-spacing: 3px;">그루텍스</span><span style="font-size: 16px; margin-left: 10px;">| GROOOTEX</span></div><div style="font-size: 11px; color: #333; line-height: 1.4;"><p style="font-weight: bold; margin-bottom: 5px;">#1002, 10F, Backsang building, 397-15, Nohae-ro, Dobong-gu, Seoul, Korea (01415)</p><p>Tel: 82 2 997 8566  Fax: 82 2 997 4888  e-mail: groootex@groootex.com</p></div></div>`;

    document.getElementById('invoice-wrapper').style.display = 'block';
    // 이벤트 리스너 추가 (동적 업데이트용)
    const invoiceTable = document.getElementById('invoice-items-table');
    if (invoiceTable) {
        invoiceTable.removeEventListener('input', handleInvoiceTableInput); // 기존 리스너 제거
        invoiceTable.addEventListener('input', handleInvoiceTableInput); // 새 리스너 추가
    }
}
// END: generateInvoice 함수 교체


function printInvoice() { window.print(); }

function saveInvoiceAsPDF() {
    html2pdf(document.getElementById('invoice-content'), {
        margin: 10, filename: '거래명세표.pdf', image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });

}

// START: 거래명세표 행 추가 및 합계 계산 함수 추가
function addInvoiceItemRow() {
    const tbody = document.getElementById('invoice-tbody'); // ID 확인: invoice-items-table tbody
    if (!tbody) return;
    const newRow = tbody.insertRow();
    newRow.className = 'invoice-item-row';
    // 컬럼 개수 11개에 맞춤 (삭제 버튼 포함)
    newRow.innerHTML = `
        <td contenteditable="true">${new Date().toISOString().slice(0,10)}</td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true">kg</td>
        <td contenteditable="true" class="invoice-quantity">0</td>
        <td contenteditable="true" class="invoice-price">0</td>
        <td class="invoice-amount">0</td>
        <td contenteditable="true"></td>
        <td class="no-print"><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); updateInvoiceTotals();">X</button></td>`;
    newRow.cells[1].focus(); // 첫 번째 편집 가능한 셀에 포커스
    updateInvoiceTotals(); // 행 추가 후 합계 재계산
}

function updateInvoiceRowTotal(cell) {
    const row = cell.closest('tr');
    if (!row) return;
    // 셀 인덱스 확인: 수량(6), 단가(7), 금액(8)
    const qtyText = row.cells[6].innerText;
    const qty = parseFloat(qtyText.replace(/[^0-9.-]+/g,"")) || 0; // 단위 무시 숫자 추출
    const price = parseFloat(row.cells[7].innerText.replace(/,/g, '')) || 0;
    row.cells[8].innerText = Math.round(qty * price).toLocaleString(); // 금액 셀 업데이트
    updateInvoiceTotals(); // 전체 합계 재계산
}

function updateInvoiceTotals() {
    const tbody = document.getElementById('invoice-tbody'); // ID 확인: invoice-items-table tbody
    if (!tbody) return;
    let totalAmount = 0;
    tbody.querySelectorAll('tr').forEach(row => {
        // 셀 인덱스 확인: 금액(8)
        totalAmount += parseFloat(row.cells[8].innerText.replace(/,/g, '')) || 0; // 행 금액 사용
    });
    const totalAmountElement = document.getElementById('invoice-total-amount');
    if (totalAmountElement) {
        totalAmountElement.innerText = Math.round(totalAmount).toLocaleString();
    }
}
// END: 거래명세표 행 추가 및 합계 계산 함수 추가




// START: generateBill 함수 교체
function generateBill() {
    document.getElementById('invoice-wrapper').style.display = 'none'; // 명세서 숨기기
    const recipientCompany = document.getElementById('recipient-company').value.trim();
    const startDate = document.getElementById('invoice-start-date').value;
    const endDate = document.getElementById('invoice-end-date').value;
    const transactionType = document.getElementById('invoice-transaction-type').value; // 명세서와 동일한 필터 사용

    if (!recipientCompany || !startDate || !endDate) {
        return alert('(*) 필수 항목(회사명, 날짜 범위)을 입력해주세요.');
    }

    // 1. 입출고 데이터 필터링 (청구서는 보통 출고 기준이나, 명세서 필터를 따름)
    const filteredTransactions = transactions.filter(t => {
        return new Date(t.date) >= new Date(startDate) && new Date(t.date) <= new Date(endDate) &&
               (transactionType === 'all' || t.type === transactionType) && // 명세서 필터 존중
               t.company.trim().toLowerCase() === recipientCompany.toLowerCase();
    });

    // 2. 매출 데이터 필터링 (출고 또는 전체 선택 시)
    const filteredSales = (transactionType === 'all' || transactionType === '출고')
        ? sales.filter(s => {
              return new Date(s.date) >= new Date(startDate) && new Date(s.date) <= new Date(endDate) &&
                     s.company.trim().toLowerCase() === recipientCompany.toLowerCase();
          })
        : [];

    // 3. 데이터 병합 및 정렬 (입고는 음수 수량으로 처리하여 합계 계산)
    let combinedItems = [];
    filteredTransactions.forEach(t => combinedItems.push({
        isTransaction: true,
        date: t.date, brand: t.brand, product: t.product, spec: t.spec, lot: t.lot, unit: 'kg',
        quantity: t.type === '입고' ? -t.weight : t.weight, // 입고는 음수로
        unitPrice: t.unitPrice, notes: t.notes
    }));
    filteredSales.forEach(s => combinedItems.push({
        isTransaction: false,
        date: s.date, brand: s.brand, product: s.product, spec: s.spec, lot: '', unit: s.unit,
        quantity: s.quantity, unitPrice: s.sellingPrice, notes: s.notes
    }));

    combinedItems.sort((a, b) => new Date(a.date) - new Date(b.date)); // 날짜순 정렬

    // 입고 포함 시 청구서 의미가 모호해질 수 있음을 알림 (선택사항)
    if (transactionType === 'all' && filteredTransactions.some(t => t.type === '입고')) {
         console.warn("청구서에 '입고' 내역이 포함되었습니다. 금액 계산에 유의하세요.");
    }

    // 4. HTML 생성
    const itemsHtml = combinedItems.map(item => {
        // 입고(음수 수량)는 금액 계산 시 제외하거나 표시만 할 수 있음. 여기선 계산에 포함.
        const subtotal = item.quantity * item.unitPrice;
        const priceEditable = item.isTransaction ? 'contenteditable="true"' : ''; // 매출 단가는 편집 불가
        const quantityDisplay = item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const unitPriceDisplay = item.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });

        return `<tr class="bill-item-row">
            <td contenteditable="true">${item.date}</td><td contenteditable="true">${item.brand || ''}</td>
            <td contenteditable="true">${item.product || ''}</td><td contenteditable="true">${item.spec || ''}</td>
            <td contenteditable="true">${item.lot || ''}</td><td contenteditable="true">${item.unit}</td>
            <td contenteditable="true" class="bill-quantity" oninput="calculateRowAndTotal(this)">${quantityDisplay}</td>
            <td ${priceEditable} class="bill-price" oninput="calculateRowAndTotal(this)">${unitPriceDisplay}</td>
            <td class="row-total">${Math.round(subtotal).toLocaleString()}</td>
            <td contenteditable="true">${item.notes || ''}</td>
            <td class="no-print"><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calculateBillTotals();">X</button></td>
        </tr> `}).join('');

    const billWrapper = document.getElementById('bill-wrapper');
    // 5. 최종 HTML 렌더링 (테이블 컬럼 개수 맞추기: 11개)
    billWrapper.innerHTML = `
        <div id="bill-controls" class="btn-group no-print" style="justify-content: flex-end; margin-bottom: 15px;">
            <button class="btn btn-info btn-sm" onclick="addBillItemRow()">➕ 항목 추가</button>
            <button class="btn btn-primary btn-sm" onclick="printBill()">🖨️ 인쇄</button>
            <button class="btn btn-warning btn-sm" onclick="saveBillAsPDF()">📄 PDF로 저장</button>
        </div>
        <div id="bill-content" class="invoice">
            <div class="invoice-header"><h2 class="invoice-title">청 구 서</h2></div>
            <div class="invoice-info">
                <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>자</td><td class="label-td">사업자번호</td><td>101-02-35223</td></tr><tr><td class="label-td">상호</td><td>그루텍스</td></tr><tr><td class="label-td">주소</td><td>서울시 도봉구 노해로 397-15 백상빌딩 1005호</td></tr></table></div>
                <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>받<br>는<br>자</td><td class="label-td">사업자번호</td><td contenteditable="true">${document.getElementById('recipient-reg-no').value}</td></tr><tr><td class="label-td">상호</td><td contenteditable="true">${recipientCompany} 귀하</td></tr><tr><td class="label-td">주소</td><td contenteditable="true">${document.getElementById('recipient-address').value}</td></tr></table></div>
            </div>
            <div class="invoice-items">
                <table id="bill-items-table">
                    <thead><tr><th>날짜</th><th>브랜드</th><th>제품</th><th>스펙</th><th>LOT</th><th>단위</th><th>수량</th><th>단가</th><th>합계</th><th>비고</th><th class="no-print" style="width: 50px;">삭제</th></tr></thead>
                    <tbody id="bill-tbody">${itemsHtml}</tbody>
                    <tfoot>
                        <tr><td colspan="6" style="text-align: right; font-weight: bold;">수량 합계</td><td id="bill-total-quantity" style="text-align: right; font-weight: bold;">0</td><td colspan="4"></td></tr>
                        <tr><td colspan="8" style="text-align: right; font-weight: bold;">공급가액 (합계)</td><td id="bill-subtotal" style="text-align: right; font-weight: bold;">0</td><td colspan="2"></td></tr>
                        <tr><td colspan="8" style="text-align: right; font-weight: bold;">부가가치세 (VAT)</td><td id="bill-vat" style="text-align: right; font-weight: bold;">0</td><td colspan="2"></td></tr>
                        <tr><td colspan="8" style="text-align: right; font-weight: bold; background-color: #f2f2f2;">총 청구금액</td><td id="bill-total" style="text-align: right; font-weight: bold; background-color: #f2f2f2;">0</td><td colspan="2"></td></tr>
                    </tfoot>
                </table>
            </div>
            <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">비 고</td><td contenteditable="true" style="height: 80px; text-align:left; vertical-align:top; padding: 5px;">은행정보: 하나은행 / 이선용(그루텍스) 221-890021-48404</td></tr></table></div>
            <div class="invoice-company-info" style="margin-top: 30px; padding: 15px; border-top: 2px solid #333; text-align: center;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin-bottom: 10px;"><span style="font-size: 18px; font-weight: bold; letter-spacing: 3px;">그루텍스</span><span style="font-size: 16px; margin-left: 10px;">| GROOOTEX</span></div><div style="font-size: 11px; color: #333; line-height: 1.4;"><p style="font-weight: bold; margin-bottom: 5px;">#1002, 10F, Backsang building, 397-15, Nohae-ro, Dobong-gu, Seoul, Korea (01415)</p><p>Tel: 82 2 997 8566  Fax: 82 2 997 4888  e-mail: groootex@groootex.com</p></div></div>
        </div>`;

    billWrapper.style.display = 'block';
    calculateBillTotals(); // 초기 합계 계산
    // 이벤트 리스너 추가 (동적 업데이트용)
    const billTable = document.getElementById('bill-items-table');
     if (billTable) {
        billTable.removeEventListener('input', handleBillTableInput); // 기존 리스너 제거
        billTable.addEventListener('input', handleBillTableInput); // 새 리스너 추가
    }
}
// END: generateBill 함수 교체

// START: 청구서 테이블 입력 핸들러 추가
function handleBillTableInput(event) {
    // 수량 또는 단가 셀이 변경되었을 때만 계산 실행
    if (event.target.classList.contains('bill-quantity') || event.target.classList.contains('bill-price')) {
        calculateRowAndTotal(event.target);
    }
}
// END: 청구서 테이블 입력 핸들러 추가

// START: 거래명세서 테이블 입력 핸들러 추가
function handleInvoiceTableInput(event) {
    // 수량 또는 단가 셀이 변경되었을 때만 계산 실행
    if (event.target.classList.contains('invoice-quantity') || event.target.classList.contains('invoice-price')) {
        updateInvoiceRowTotal(event.target);
    }
}
// END: 거래명세서 테이블 입력 핸들러 추가


function printBill() { window.print(); }
function saveBillAsPDF() {
    html2pdf(document.getElementById('bill-content'), {
        margin: 10, filename: '청구서.pdf', image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });

}

// START: calculateRowAndTotal 함수 교체
function calculateRowAndTotal(cell) {
    const row = cell.closest('tr');
    if (!row) return;
    // 셀 인덱스 확인: 수량(6), 단가(7), 합계(8)
    const qtyText = row.cells[6].innerText;
    const qty = parseFloat(qtyText.replace(/[^0-9.-]+/g,"")) || 0; // 단위 무시하고 숫자만 추출
    const price = parseFloat(row.cells[7].innerText.replace(/,/g, '')) || 0;
    row.cells[8].innerText = Math.round(qty * price).toLocaleString(); // 합계 셀 업데이트
    calculateBillTotals(); // 전체 합계 재계산
}
// END: calculateRowAndTotal 함수 교체


// START: calculateBillTotals 함수 교체
function calculateBillTotals() {
    const tbody = document.getElementById('bill-tbody'); // ID 확인: bill-items-table tbody
    if (!tbody) return;
    let subtotal = 0, totalQty = 0;
    tbody.querySelectorAll('tr').forEach(row => {
        // 셀 인덱스 확인: 수량(6), 합계(8)
        totalQty += parseFloat(row.cells[6].innerText.replace(/[^0-9.-]+/g,"")) || 0; // 수량에서 숫자만 추출
        subtotal += parseFloat(row.cells[8].innerText.replace(/,/g, '')) || 0; // 행 합계 사용
    });
    const vat = subtotal * 0.1;
    document.getElementById('bill-total-quantity').innerText = totalQty.toLocaleString(undefined, { maximumFractionDigits: 2 });
    document.getElementById('bill-subtotal').innerText = Math.round(subtotal).toLocaleString();
    document.getElementById('bill-vat').innerText = Math.round(vat).toLocaleString();
    document.getElementById('bill-total').innerText = Math.round(subtotal + vat).toLocaleString();
}
// END: calculateBillTotals 함수 교체


// START: addBillItemRow 함수 교체
function addBillItemRow() {
    const tbody = document.getElementById('bill-tbody'); // ID 확인: bill-items-table tbody
    if (!tbody) return;
    const newRow = tbody.insertRow();
    newRow.className = 'bill-item-row';
    // 컬럼 개수 11개에 맞춤 (삭제 버튼 포함)
    newRow.innerHTML = `
        <td contenteditable="true">${new Date().toISOString().slice(0,10)}</td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true">kg</td>
        <td contenteditable="true" class="bill-quantity" oninput="calculateRowAndTotal(this)">0</td>
        <td contenteditable="true" class="bill-price" oninput="calculateRowAndTotal(this)">0</td>
        <td class="row-total">0</td>
        <td contenteditable="true"></td>
        <td class="no-print"><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calculateBillTotals();">X</button></td>`;
    newRow.cells[1].focus(); // 첫 번째 편집 가능한 셀에 포커스
    calculateBillTotals(); // 행 추가 후 합계 재계산
}
// END: addBillItemRow 함수 교체

// ================== 4-4. 매출 보고서 생성 함수 ==================
function generateSalesReport() {
    const startDate = document.getElementById('filter-report-start-date').value;
    const endDate = document.getElementById('filter-report-end-date').value;
    const companyFilter = document.getElementById('filter-report-company').value.toLowerCase();
    const brandFilter = document.getElementById('filter-report-brand').value.toLowerCase();
    const itemCategoryFilter = document.getElementById('filter-report-item-category').value.toLowerCase();
    const productFilter = document.getElementById('filter-report-product').value.toLowerCase();
    const specFilter = document.getElementById('filter-report-spec').value.toLowerCase();

    const outgoingTransactions = transactions.filter(t => {
        const transactionDate = new Date(t.date);
        const startCheck = !startDate || transactionDate >= new Date(startDate);
        const endCheck = !endDate || transactionDate <= new Date(endDate);
        return t.type === '출고' && startCheck && endCheck &&
            (!companyFilter || t.company.toLowerCase().includes(companyFilter)) &&
            (!brandFilter || (t.brand||'').toLowerCase().includes(brandFilter)) &&
            (!itemCategoryFilter || '원자재'.includes(itemCategoryFilter)) &&
            (!productFilter || (t.product || '').toLowerCase().includes(productFilter)) &&
            (!specFilter || (t.spec || '').toLowerCase().includes(specFilter));
    });

    const salesData = sales.filter(s => {
        const saleDate = new Date(s.date);
        const startCheck = !startDate || saleDate >= new Date(startDate);
        const endCheck = !endDate || saleDate <= new Date(endDate);
        return startCheck && endCheck &&
            (!companyFilter || s.company.toLowerCase().includes(companyFilter)) &&
            (!brandFilter || (s.brand||'').toLowerCase().includes(brandFilter)) &&
            (!itemCategoryFilter || (s.itemCategory || '').toLowerCase().includes(itemCategoryFilter)) &&
            (!productFilter || (s.product || '').toLowerCase().includes(productFilter)) &&
            (!specFilter || (s.spec || '').toLowerCase().includes(specFilter));
    });

    let reportData = [];

    outgoingTransactions.forEach(t => {
        const matchingInbound = transactions.filter(it => it.type === '입고' && it.brand === t.brand && it.lot === t.lot).sort((a,b) => new Date(b.date) - new Date(a.date));
        const costPrice = matchingInbound.length > 0 ? matchingInbound[0].unitPrice : 0;
        const salesAmount = t.weight * t.unitPrice;
        const costOfGoods = t.weight * costPrice;
        const totalCosts = costOfGoods;
        const margin = salesAmount - totalCosts;
        
        reportData.push({
            date: t.date, company: t.company, brand: t.brand,
            itemCategory: '원자재',
            product: t.product, spec: t.spec, lot: t.lot,
            quantity: t.weight, totalCosts: totalCosts, salesAmount: salesAmount, margin: margin
        });
    });

    salesData.forEach(s => {
        reportData.push({
            date: s.date, company: s.company, brand: s.brand,
            itemCategory: s.itemCategory, product: s.product, spec: s.spec, lot: '',
            quantity: s.quantity, totalCosts: s.quantity * s.costPrice, salesAmount: s.totalSales, margin: s.totalMargin
        });
    });

    const tbody = document.getElementById('sales-report-tbody');
    tbody.innerHTML = '';
    let totalSalesAmount = 0, totalCostsSum = 0, totalMarginSum = 0;

    reportData.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(item => {
        const marginRate = item.salesAmount !== 0 ? (item.margin / item.salesAmount * 100).toFixed(2) : 0;
        totalSalesAmount += item.salesAmount;
        totalCostsSum += item.totalCosts;
        totalMarginSum += item.margin;

        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${item.date.substring(0, 7)}</td><td>${item.company}</td><td>${item.brand}</td>
            <td>${item.itemCategory}</td><td>${item.product || ''}</td><td>${item.spec || ''}</td>
            <td>${item.lot || ''}</td><td>${item.quantity.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
            <td>${Math.round(item.totalCosts).toLocaleString()}</td>
            <td>${Math.round(item.salesAmount).toLocaleString()}</td>
            <td>${Math.round(item.margin).toLocaleString()}</td><td>${marginRate}%</td>`;
    });

    const totalMarginRate = totalSalesAmount !== 0 ? (totalMarginSum / totalSalesAmount * 100).toFixed(2) : '0.00';
    document.getElementById('total-sales-total-costs').innerText = Math.round(totalCostsSum).toLocaleString();
    document.getElementById('total-sales-amount').innerText = Math.round(totalSalesAmount).toLocaleString();
    document.getElementById('total-sales-margin').innerText = Math.round(totalMarginSum).toLocaleString();
    document.getElementById('total-sales-margin-rate').innerText = `${totalMarginRate}%`;
}


function toggleAllCheckboxes(className, checked) {
    document.querySelectorAll(`.${className}`).forEach(checkbox => checkbox.checked = checked);
}

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
    newRow.innerHTML = `<td><input type="text" class="item-name" oninput="ic_calculateAll()"></td><td><input type="text" class="item-lot" oninput="ic_calculateAll()"></td><td><input type="text" class="item-qty" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><input type="text" class="item-unit" oninput="ic_calculateAll()"></td><td><input type="text" class="item-price" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); ic_calculateAll();">-</button></td>`;
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
    document.getElementById('ic-submit-btn').onclick = () => ic_processCostSheet(false);
    document.getElementById('ic-cancel-btn').style.display = 'none';
}
function ic_resetFilters() {
    ['filter-ic-start-date', 'filter-ic-end-date', 'filter-shipper', 'filter-item', 'filter-lot'].forEach(id => document.getElementById(id).value = '');
    ic_renderList();
}
function ic_calculateAll() {
    let totalInvoiceValue = 0;
    const items = [];
    document.querySelectorAll('#item-tbody tr').forEach(row => {
        const item = { name: row.querySelector('.item-name').value.trim(), lot: row.querySelector('.item-lot').value.trim(), qty: ic_pFloat(row.querySelector('.item-qty').value), unit: row.querySelector('.item-unit').value.trim(), price: ic_pFloat(row.querySelector('.item-price').value) };
        totalInvoiceValue += item.qty * item.price;
        items.push(item);
    });
    document.getElementById('total-invoice-value').textContent = '$' + totalInvoiceValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const exchangeRate = ic_pFloat(document.getElementById('form-exchange-rate').value), shippingFee = ic_pFloat(document.getElementById('form-shipping-fee').value), tariffAmount = ic_pFloat(document.getElementById('form-tariff-amount').value), fFee1 = ic_pFloat(document.getElementById('form-forwarder-fee1').value), fFee2 = ic_pFloat(document.getElementById('form-forwarder-fee2').value), fFee3 = ic_pFloat(document.getElementById('form-forwarder-fee3').value);
    const invoiceKrw = totalInvoiceValue * exchangeRate, totalMaterialCost = invoiceKrw + shippingFee, tariffCost = tariffAmount, totalForwarderFee = fFee1 + fFee2 + fFee3, grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;
    
    const resultTbody = document.getElementById('result-tbody');
    resultTbody.innerHTML = '';
    items.forEach(item => {
        let unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
        const newRow = resultTbody.insertRow();
        newRow.innerHTML = `<td>${item.name || 'N/A'}</td> <td>${item.lot || 'N/A'}</td> <td>${item.qty.toLocaleString()}</td> <td>${item.unit || 'N/A'}</td> <td>$${(item.qty * item.price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td> <td class="highlight calculated-field">₩${Math.round(unitCost).toLocaleString()}</td>`;
    });
}
function ic_renderList() {
    const tbody = document.getElementById('cost-list-tbody');
    tbody.innerHTML = '';
    const filters = { start: document.getElementById('filter-ic-start-date').value, end: document.getElementById('filter-ic-end-date').value, shipper: document.getElementById('filter-shipper').value.toLowerCase(), item: document.getElementById('filter-item').value.toLowerCase(), lot: document.getElementById('filter-lot').value.toLowerCase() };
    const filtered = ic_costSheets.filter(sheet => {
        const etdDate = sheet.etd ? new Date(sheet.etd) : null;
        return (!filters.start || (etdDate && etdDate >= new Date(filters.start))) &&
               (!filters.end || (etdDate && etdDate <= new Date(filters.end))) &&
               sheet.shipper.toLowerCase().includes(filters.shipper) &&
               (!filters.item || sheet.items.some(item => (item.name || item.itemName).toLowerCase().includes(filters.item))) &&
               (!filters.lot || sheet.items.some(item => item.lot.toLowerCase().includes(filters.lot)));
    }).sort((a,b) => (b.etd || '').localeCompare(a.etd || ''));

    filtered.forEach(sheet => {
        sheet.items.forEach((item, index) => {
            const row = tbody.insertRow();
            if (index === 0) row.innerHTML = `<td rowspan="${sheet.items.length}" style="text-align:center;"><input type="checkbox" class="sheet-checkbox" value="${sheet.id}"></td> <td rowspan="${sheet.items.length}">${sheet.eta || ''}</td> <td rowspan="${sheet.items.length}">${sheet.shipper}</td>`;
            row.innerHTML += `<td>${item.name || item.itemName}</td><td>${item.lot}</td><td>${(item.qty || 0).toLocaleString()} ${item.unit}</td> <td>$${(item.price || 0).toLocaleString()}</td><td>${sheet.terms}</td> <td>${sheet.origin}</td> <td>${sheet.method}</td><td>${sheet.cbm}</td> <td>${sheet.packing || ''}</td> <td>${sheet.tariffRate || 0}%</td><td>${ic_pFloat(sheet.exchangeRate).toLocaleString()}</td> <td class="highlight">₩${Math.round(item.unitCost || 0).toLocaleString()}</td>`;
        });
    });
}
function ic_editSelectedSheet() {
    const selectedIds = Array.from(document.querySelectorAll('.sheet-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    const sheet = ic_costSheets.find(s => s.id === selectedIds[0]);
    if (!sheet) return;
    ic_editingId = sheet.id;
    ['shipper', 'terms', 'origin', 'method', 'etd', 'eta', 'cbm'].forEach(key => document.getElementById(`form-${key}`).value = sheet[key] || '');
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
        newRow.innerHTML = `<td><input type="text" class="item-name" value="${item.name || item.itemName}" oninput="ic_calculateAll()"></td><td><input type="text" class="item-lot" value="${item.lot}" oninput="ic_calculateAll()"></td><td><input type="text" class="item-qty" value="${item.qty || 0}" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><input type="text" class="item-unit" value="${item.unit}" oninput="ic_calculateAll()"></td><td><input type="text" class="item-price" value="${item.price || 0}" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); ic_calculateAll();">-</button></td>`;
    });
    ['form-exchange-rate', 'form-shipping-fee', 'form-tariff-amount', 'form-vat-amount', 'form-forwarder-fee1', 'form-forwarder-fee2', 'form-forwarder-fee3'].forEach(id => ic_formatInputForDisplay(document.getElementById(id)));
    document.querySelectorAll('.item-qty, .item-price').forEach(ic_formatInputForDisplay);
    ic_calculateAll();
    document.getElementById('ic-form-title').textContent = '수입 정산 수정';
    document.getElementById('ic-submit-btn').textContent = '수정 저장';
    document.getElementById('ic-submit-btn').onclick = () => ic_processCostSheet(true);
    document.getElementById('ic-cancel-btn').style.display = 'inline-block';
    window.scrollTo(0, 0);
}
function ic_toggleAllListCheckboxes(checked) { document.querySelectorAll('.sheet-checkbox').forEach(cb => cb.checked = checked); }
function ic_printForm() { window.print(); }
function ic_exportListToCsv() {
    const csvData = [];
    ic_costSheets.forEach(sheet => sheet.items.forEach(item => csvData.push({ "ETA": sheet.eta, "Shipper": sheet.shipper, "품목": item.name || item.itemName, "LOT": item.lot, "수량 (단위)": `${item.qty || 0} ${item.unit}`, "단가($)": item.price || 0, "Terms": sheet.terms, "C/O": sheet.origin, "Method": sheet.method, "CBM": sheet.cbm, "포장": sheet.packing || '', "관세(%)": sheet.tariffRate || 0, "환율": sheet.exchangeRate, "수입원가(원)": Math.round(item.unitCost || 0) })));
    downloadCSV(Papa.unparse(csvData), `수입정산내역_${new Date().toISOString().slice(0,10)}`);
}
function ic_openBulkUploadModal() {
    const modal = document.getElementById('ic_bulkUploadModal'); 
    if (modal) { modal.style.display = 'flex'; document.getElementById('ic_bulk-upload-form').reset(); document.getElementById('ic_bulk-upload-process-btn').disabled = true; document.getElementById('ic_bulk-upload-status').innerHTML = ''; }
}
function ic_closeBulkUploadModal() { document.getElementById('ic_bulkUploadModal').style.display = 'none'; }
function ic_downloadBulkTemplate() {
    const headers = ["그룹ID*", "Shipper*", "ETD*(YYYY-MM-DD)", "ETA(YYYY-MM-DD)", "적용환율*", "Terms", "Origin", "Method", "CBM", "포장", "은행 송금수수료(원)", "관세율(%)", "관세(원)", "부가가치세(원)", "현지 내륙 총 비용(원)", "수입 총 비용(원)", "국내 내륙 운송비(원)", "품목*", "LOT*", "수량*", "단위", "단가($)*"];
    downloadCSV(headers.join(',') + '\r\n', '수입정산서_일괄등록_템플릿');
}
function ic_processBulkUpload() { /* (기존 대량 업로드 로직 유지) */ }

// ================== 5. HTML onclick과 함수 연결 ==================
window.addTransaction = () => processTransaction(false);
window.editSelectedTransaction = editSelectedTransaction;
window.deleteSelectedTransactions = deleteSelectedTransactions;
window.cancelTransactionEdit = cancelTransactionEdit;
window.showTab = showTab;
window.toggleOtherCostsField = toggleOtherCostsField;
window.openBulkUploadModal = openBulkUploadModal;
window.resetTransactionFilters = resetTransactionFilters;
window.exportTransactionCSV = exportTransactionCSV;
window.toggleAllCheckboxes = toggleAllCheckboxes;
window.processBulkUpload = processBulkUpload;
window.closeBulkUploadModal = closeBulkUploadModal;
window.downloadBulkTransactionTemplate = downloadBulkTransactionTemplate;
window.resetInventoryFilters = resetInventoryFilters;
window.exportInventoryCSV = exportInventoryCSV;
window.showItemHistoryInTransactionTab = showItemHistoryInTransactionTab;
window.addSale = () => processSale(false);
window.calculateSales = calculateSales;
window.editSelectedSale = editSelectedSale;
window.deleteSelectedSales = deleteSelectedSales;
window.cancelSaleEdit = cancelSaleEdit;
window.resetSalesFilters = resetSalesFilters;
window.exportSalesCSV = exportSalesCSV;
window.addRemittance = () => processRemittance(false);
window.calculateRemittance = calculateRemittance;
window.editSelectedRemittance = editSelectedRemittance;
window.deleteSelectedRemittances = deleteSelectedRemittances;
window.cancelRemittanceEdit = cancelRemittanceEdit;
window.resetRemittanceFilters = resetRemittanceFilters;
window.exportRemittanceCSV = exportRemittanceCSV;
// START: CSV 관련 함수 window 연결 추가
window.downloadSalesCsvTemplate = downloadSalesCsvTemplate;
window.handleSalesCsvUpload = handleSalesCsvUpload;
window.processSalesCsvUpload = processSalesCsvUpload;
window.cancelSalesCsvUpload = cancelSalesCsvUpload;
window.downloadRemittanceCsvTemplate = downloadRemittanceCsvTemplate;
window.handleRemittanceCsvUpload = handleRemittanceCsvUpload;
window.processRemittanceCsvUpload = processRemittanceCsvUpload;
window.cancelRemittanceCsvUpload = cancelRemittanceCsvUpload;
// END: CSV 관련 함수 window 연결 추가
window.generateInvoice = generateInvoice;
window.printInvoice = printInvoice;
// START: 거래명세표/청구서 관련 함수 window 연결 추가
window.saveInvoiceAsPDF = saveInvoiceAsPDF;
window.addInvoiceItemRow = addInvoiceItemRow; // 거래명세표 행 추가
window.updateInvoiceTotals = updateInvoiceTotals; // 거래명세표 합계 업데이트 (내부 호출용이지만 연결)
window.generateBill = generateBill;
window.addBillItemRow = addBillItemRow; // 청구서 행 추가
window.printBill = printBill;
window.saveBillAsPDF = saveBillAsPDF;
window.calculateRowAndTotal = calculateRowAndTotal; // 청구서 행 계산
window.calculateBillTotals = calculateBillTotals; // 청구서 전체 합계
window.handleBillTableInput = handleBillTableInput; // 청구서 테이블 입력 핸들러
window.handleInvoiceTableInput = handleInvoiceTableInput; // 거래명세서 테이블 입력 핸들러
// END: 거래명세표/청구서 관련 함수 window 연결 추가

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
window.ic_toggleAllListCheckboxes = ic_toggleAllListCheckboxes;
window.ic_closeBulkUploadModal = ic_closeBulkUploadModal;
window.ic_downloadBulkTemplate = ic_downloadBulkTemplate;
window.ic_processBulkUpload = ic_processBulkUpload;
window.backupDataToJson = backupDataToJson;
window.restoreDataFromJson = restoreDataFromJson;
window.loadBackupFile = loadBackupFile;
window.ic_deleteSelectedSheets = ic_deleteSelectedSheets;




