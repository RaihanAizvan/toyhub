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


/// cart

// // script.js

// console.log('Script loaded');

// // Initialize Toastr
// toastr.options = {
//     closeButton: true,
//     progressBar: true,
//     positionClass: "toast-top-right",
//     timeOut: 3000
// };



// function addToCart(event) {
//     console.log('Add to cart clicked');
//     event.preventDefault();
//     event.stopPropagation();

//     const productId = event.target.closest('.add-to-cart-btn').dataset.productId;
//     const quantity = 1;

//     console.log('Product ID:', productId);

//     axios.post('/cart/addProduct', {
//         productId: productId,
//         quantity: quantity
//     })
//     .then(response => {
//         console.log('Success:', response.data);
//         toastr.success(response.data.message || 'Product added to cart!');
//         if (response.data.cartItemCount !== undefined) {
//             updateCartItemCount(response.data.cartItemCount);
//         }
//     })
//     .catch(error => {
//         console.error('Error:', error);
//         toastr.error(error.response?.data?.message || 'Failed to add product to cart.');
//     });
// }

// function updateCartItemCount(count) {
//     const cartCountElement = document.getElementById('cart-count');
//     if (cartCountElement) {
//         cartCountElement.innerText = count;
//     }
// }

// // Add event listeners to all "Add to Cart" buttons
// document.addEventListener('DOMContentLoaded', function() {
//     console.log('DOM loaded');
//     const addToCartButtons = document.querySelectorAll('.add-to-cart-btn');
//     addToCartButtons.forEach(button => {
//         button.addEventListener('click', addToCart);
//     });
// });


