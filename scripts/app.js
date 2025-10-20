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

    // 거래명세표/청구서 탭이 아닐 경우 관련 영역 숨기기
    if (tabName !== 'invoice') {
         const invoiceWrapper = document.getElementById('invoice-wrapper');
         const billWrapper = document.getElementById('bill-wrapper');
         if(invoiceWrapper) invoiceWrapper.style.display = 'none';
         if(billWrapper) billWrapper.style.display = 'none';
    }
    // 'invoice' 탭일 경우, generateInvoice/generateBill 함수가 display를 'block'으로 설정합니다.
}

const ic_pFloat = (val) => parseFloat(String(val).replace(/,/g, '')) || 0;

