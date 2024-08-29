// to handle the hower case of header
document.addEventListener('DOMContentLoaded', function () {
    const button = document.querySelector('.relative .inline-flex');
    const dropdown = document.querySelector('.relative .hidden');

    button.addEventListener('mouseover', function () {
        dropdown.classList.remove('hidden');
    });

    button.addEventListener('mouseout', function () {
        dropdown.classList.add('hidden');
    });
});

//otp auto move to next field
function moveOnMax(current, nextFieldId) {
    if (current.value.length >= current.maxLength) {
        const nextField = document.getElementById(nextFieldId);
        if (nextField) {
            nextField.focus();
        }   
    }
}